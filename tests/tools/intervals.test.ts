import { describe, expect, it, vi } from 'vitest';
import { IntervalsClient } from '../../src/intervals/client';
import { TrainingService } from '../../src/tools/service';
import { activities, athlete, fixtureFetch } from '../fixtures/data';
import { requestUrl } from '../helpers';

function service(requestFetch: typeof fetch) {
  return new TrainingService(
    new IntervalsClient({ apiKey: 'test', athleteId: '0', fetch: requestFetch, logger: () => {} }),
    { timezone: 'Asia/Jakarta' },
  );
}

describe('interval analysis retrieval boundaries', () => {
  it('reuses bounded details and only makes GET calls to the existing three endpoints', async () => {
    const upstream = vi.fn(fixtureFetch());
    const result = await service(upstream).runningIntervals({
      activity_id: 'a2',
      target_pace_s_per_km: 310,
    });
    expect(result.analysis.work.count).toBe(1);
    expect(result.analysis.intervals[0]!.target_pace_difference_s_per_km).toBe(-10);
    expect(upstream.mock.calls.map(([input]) => new URL(requestUrl(input)).pathname)).toEqual([
      '/api/v1/activity/a2',
      '/api/v1/athlete/0',
      '/api/v1/activity/a2/intervals',
    ]);
    expect(
      upstream.mock.calls.every(([, init]) => init?.method === undefined || init.method === 'GET'),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('MUST-NOT-LEAK');
  });

  it('validates arguments before making any upstream calls', async () => {
    const upstream = vi.fn(fixtureFetch());
    await expect(
      service(upstream).runningIntervals({ activity_id: 'a2', work_interval_indexes: [1, 1] }),
    ).rejects.toThrow();
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([null, 'different-athlete'])(
    'refuses absent or mismatched ownership %s before fetching intervals',
    async (owner) => {
      const upstream = vi.fn<typeof fetch>(async (input) =>
        new URL(requestUrl(input)).pathname === '/api/v1/athlete/0'
          ? Response.json(athlete)
          : Response.json({ ...activities[0], icu_athlete_id: owner }),
      );
      await expect(service(upstream).runningIntervals({ activity_id: 'a2' })).rejects.toMatchObject(
        { category: 'upstream_forbidden' },
      );
      expect(upstream.mock.calls).toHaveLength(2);
    },
  );

  it('rejects intervals from a different activity', async () => {
    const base = fixtureFetch();

    const upstream: typeof fetch = async (input, init) =>
      new URL(requestUrl(input)).pathname.endsWith('/intervals')
        ? Response.json({ id: 'other', icu_intervals: [] })
        : base(input, init);

    await expect(service(upstream).runningIntervals({ activity_id: 'a2' })).rejects.toMatchObject({
      category: 'invalid_response',
    });
  });

  it('propagates the source truncation flag instead of analyzing the first 200 as a complete workout', async () => {
    const base = fixtureFetch();

    const upstream: typeof fetch = async (input, init) =>
      new URL(requestUrl(input)).pathname.endsWith('/intervals')
        ? Response.json({
            id: 'a2',
            icu_intervals: Array.from({ length: 201 }, (_, i) => ({
              type: 'WORK',
              start_time: i * 300,
              end_time: (i + 1) * 300,
              distance: 1000,
              moving_time: 300,
              average_speed: 10 / 3,
            })),
          })
        : base(input, init);

    const result = await service(upstream).runningIntervals({ activity_id: 'a2' });
    expect(result.analysis.intervals).toHaveLength(200);
    expect(result.analysis.data_quality.intervals_truncated).toBe(true);
    expect(result.analysis.work.distance_m).toMatchObject({
      value: null,
      known_sum: 200000,
      complete_returned_records: false,
    });
    expect(result.analysis.work_pace_statistics_s_per_km.mean).toBeNull();
  });
});
