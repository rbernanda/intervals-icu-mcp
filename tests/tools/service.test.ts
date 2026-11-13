import { describe, expect, it } from 'vitest';
import { TrainingService } from '../../src/tools/service';
import { IntervalsClient } from '../../src/intervals/client';
import { fixtureFetch, activities, wellness, events } from '../fixtures/data';
import { normalizeActivity, normalizeFitness } from '../../src/intervals/normalizers';
import { aggregateSummary, sumRecorded } from '../../src/domain/summary';
import { activitySchema } from '../../src/intervals/schemas';
import { checkRange, todayInTimezone } from '../../src/utils/dates';
function service(requestFetch = fixtureFetch()) {
  return new TrainingService(
    new IntervalsClient({ apiKey: 'test', athleteId: '0', fetch: requestFetch, logger: () => {} }),
    { timezone: 'Asia/Jakarta', now: () => new Date('2026-11-13T01:00:00Z') },
  );
}
const range = { start_date: '2026-11-01', end_date: '2026-11-15' };
describe('normalization and aggregation', () => {
  it('preserves source meters and seconds, converts speed to pace and rpm to running spm', () => {
    const result = normalizeActivity(activitySchema.parse(activities[0]));
    expect(result).toMatchObject({
      distance_m: 21000,
      moving_time_s: 6300,
      elapsed_time_s: 6500,
      average_pace_s_per_km: 300,
      average_cadence_spm: 170,
      average_cadence_source_rpm: 85,
      training_load: 120,
    });
  });
  it('keeps absent/zero values distinct; never divides by zero', () => {
    const result = normalizeActivity({ id: 'a', average_speed: 0, distance: 0 });
    expect(result.distance_m).toBe(0);
    expect(result.moving_time_s).toBeNull();
    expect(result.average_pace_s_per_km).toBeNull();
  });
  it('does not claim non-running cadence is steps per minute', () => {
    expect(
      normalizeActivity({ id: 'a', type: 'Ride', average_cadence: 80 }).average_cadence_spm,
    ).toBeNull();
  });
  it('uses source fitness and clearly marks derived form and missing values', () => {
    expect(normalizeFitness(wellness[0]!)).toMatchObject({
      fitness_ctl: 50,
      fatigue_atl: 70,
      source_form_tsb: null,
      computed_form: { value: -20, origin: 'computed' },
      source_values: { ctlLoad: 120, atlLoad: 118 },
    });
    expect(normalizeFitness({ id: '2026-11-13', ctl: 50 }).computed_form.value).toBeNull();
  });
  it('does not report incomplete sums as totals or assume missing metrics zero', () => {
    expect(sumRecorded([5, null])).toEqual({
      value: null,
      recorded_count: 1,
      missing_count: 1,
      complete: false,
    });
    expect(sumRecorded([]).value).toBe(0);
  });
  it('handles local dates, leap dates, invalid dates and inclusive limits', () => {
    expect(todayInTimezone(new Date('2026-11-12T23:00:00Z'), 'Asia/Jakarta')).toBe('2026-11-13');
    expect(() => checkRange({ start_date: '2026-02-30', end_date: '2026-03-01' })).toThrow();
    expect(() => checkRange({ start_date: '2026-11-02', end_date: '2026-11-01' })).toThrow();
    expect(checkRange({ start_date: '2024-02-29', end_date: '2024-02-29' })).toBeDefined();
  });
  it('marks partial Monday weeks and refuses a longest run with unknown distances', () => {
    const result = aggregateSummary(
      [normalizeActivity({ id: 'a', type: 'Run', start_date_local: '2026-11-13T06:00:00' })],
      [],
      range,
    );
    expect(result.weekly_running_distance[0]?.partial_week).toBe(true);
    expect(result.longest_run).toBeNull();
  });
});
describe('all seven tools independently', () => {
  it('returns only approved athlete fields', async () => {
    const result = await service().profile({});
    expect(result.athlete.id).toBe('i123');
    expect(JSON.stringify(result)).not.toMatch(/MUST-NOT-LEAK|private@example/);
  });
  it('defaults ranges and limits, sorts newest and supports running family', async () => {
    const result = await service().recent({ sport_type: 'running', limit: 1 });
    expect(result.range).toEqual({ start_date: '2026-10-17', end_date: '2026-11-13' });
    expect(result.matching_count).toBe(2);
    expect(result.activities.map((a) => a.id)).toEqual(['a2']);
  });
  it('does not request intervals unless explicitly asked', async () => {
    const paths: string[] = [];
    const sourceFetch = fixtureFetch();
    const s = service(async (url, init) => {
      paths.push(String(url));
      return sourceFetch(url, init);
    });
    expect((await s.detail({ activity_id: 'a2' })).intervals).toBeNull();
    expect(paths.some((path) => new URL(path).pathname.endsWith('/intervals'))).toBe(false);
    expect(
      (await s.detail({ activity_id: 'a2', include_intervals: true })).intervals?.[0]
        ?.average_pace_s_per_km,
    ).toBe(300);
  });
  it('rejects an activity from another athlete before accessing intervals', async () => {
    const base = fixtureFetch();
    const s = service(async (url, init) =>
      String(url).includes('/activity/')
        ? Response.json({ ...activities[0], icu_athlete_id: 'i999' })
        : base(url, init),
    );
    await expect(s.detail({ activity_id: 'a2', include_intervals: true })).rejects.toMatchObject({
      category: 'upstream_forbidden',
    });
  });
  it('returns source CTL and ATL and nullable wellness metrics', async () => {
    expect((await service().fitness(range)).daily[0]?.fitness_ctl).toBe(50);
    expect((await service().wellness(range)).daily[0]).toMatchObject({
      resting_heart_rate_bpm: 45,
      sleep_duration_s: 28800,
      hrv_source: null,
    });
  });
  it('uses explicit pairing for completion and keeps past workouts planned', async () => {
    const result = await service().calendar(range);
    expect(result.entries.find((e) => e.event_id === 10)).toMatchObject({
      status: 'completed',
      activity_id: 'a2',
      planned_distance_m: 20000,
      actual_distance_m: 21000,
    });
    expect(result.entries.filter((e) => e.event_id === 10)).toHaveLength(1);
    expect(result.entries.find((e) => e.event_id === 11)?.status).toBe('planned');
    expect(result.entries.find((e) => e.event_id === 12)?.status).toBe('calendar_event');
  });
  it('computes summaries from complete records and reports latest source fitness', async () => {
    const result = await service().summary({ days: 7, sport_type: 'Run' });
    expect(result.summary).toMatchObject({
      activity_count: 2,
      total_distance_m: { value: 30000 },
      total_training_load: { value: 170 },
      average_weekly_running_distance_m: 30000,
      longest_run: { id: 'a2' },
      latest_fitness: { fitness_ctl: 50, fatigue_atl: 70 },
    });
  });
  it('handles empty results without fabricating fitness or workouts', async () => {
    const s = service(async () => Response.json([]));
    expect((await s.recent({})).activities).toEqual([]);
    expect((await s.fitness(range)).daily).toEqual([]);
    expect((await s.calendar(range)).entries).toEqual([]);
    expect((await s.summary({})).summary.latest_fitness).toBeNull();
  });
  it('rejects invalid inputs, date ranges and too-large limits', async () => {
    await expect(service().recent({ limit: 101 })).rejects.toThrow();
    await expect(service().summary({ days: 10 })).rejects.toThrow();
    await expect(
      service().wellness({ start_date: '2026-01-01', end_date: '2026-12-31' }),
    ).rejects.toThrow('90');
    await expect(service().profile({ api_key: 'x' })).rejects.toThrow();
  });
  it('detects saturated activity results and never returns incomplete summary totals', async () => {
    const base = fixtureFetch();
    const s = service(async (url, init) =>
      String(url).includes('/activities')
        ? Response.json(Array.from({ length: 1001 }, (_, i) => ({ ...activities[0], id: `a${i}` })))
        : base(url, init),
    );
    expect((await s.recent({ limit: 100 })).activities).toHaveLength(100);
    expect((await s.recent({})).upstream_saturated).toBe(true);
    await expect(s.summary({})).rejects.toMatchObject({ category: 'response_too_large' });
  });
  it('detects saturated event results', async () => {
    const base = fixtureFetch();
    const s = service(async (url, init) =>
      String(url).includes('/events')
        ? Response.json(Array.from({ length: 301 }, (_, id) => ({ ...events[0], id })))
        : base(url, init),
    );
    await expect(s.calendar(range)).rejects.toMatchObject({ category: 'response_too_large' });
  });
  it('does not silently aggregate restricted activity stubs', async () => {
    const base = fixtureFetch();
    const s = service(async (url, init) =>
      String(url).includes('/activities') ? Response.json([{ id: 'hidden' }]) : base(url, init),
    );
    await expect(s.summary({})).rejects.toMatchObject({ category: 'invalid_response' });
  });
});
