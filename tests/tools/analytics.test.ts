import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from '../../src/tools/analytics/service';
import { analyticsInputs, analyticsOutputs } from '../../src/tools/analytics/contracts';
import { IntervalsClient } from '../../src/intervals/client';
import { fixtureFetch } from '../fixtures/data';
import { requestUrl } from '../helpers';

const range = { start_date: '2026-11-08', end_date: '2026-11-14' };
const compare = {
  current: range,
  baseline: { start_date: '2026-11-01', end_date: '2026-11-07' },
  sport_type: 'running',
};

function service(requestFetch = fixtureFetch(), timezone = 'Asia/Jakarta') {
  return new AnalyticsService(
    new IntervalsClient({
      apiKey: 'synthetic-key',
      athleteId: '0',
      fetch: requestFetch,
      logger: () => {},
    }),
    { timezone, now: () => new Date('2026-11-14T00:00:00Z') },
  );
}

describe('bounded analytics MCP service adapter', () => {
  it('keeps defaults valid when the MCP SDK and service both validate arguments', () => {
    for (const schema of [analyticsInputs.efficiency, analyticsInputs.workouts]) {
      const parsed = schema.parse(range);
      expect(schema.parse(parsed)).toEqual(parsed);
    }
  });
  it('validates structured outputs, source fitness and partial today; only issues GET requests', async () => {
    const upstream = vi.fn<typeof fetch>(fixtureFetch());
    const result = await service(upstream).compare(compare);
    expect(analyticsOutputs.compare.safeParse(result).success).toBe(true);
    expect(result.analysis.current.metrics.distance_m.value).toBe(30000);
    expect(result.analysis.baseline.metrics.distance_m.value).toBe(0);
    expect(result.analysis.changes.distance_m.unavailable_reason).toBe('ZERO_BASELINE');
    expect(result.analysis.current.fitness.computed_same_day_form).toBe(-20);
    expect(result.analysis.current.data_quality.current_day_included).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(4);
    for (const [url, init] of upstream.mock.calls) {
      expect(init?.method).toBe('GET');
      expect(new URL(requestUrl(url)).pathname).toMatch(/\/(activities|wellness)$/);
    }
  });

  it('does not fetch profiles, intervals or wellness for a running comparison', async () => {
    const upstream = vi.fn<typeof fetch>(fixtureFetch());
    expect(
      (await service(upstream).workouts({ ...range, session_type: 'long_run' })).analysis.status,
    ).toBe('insufficient_evidence');
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(new URL(requestUrl(upstream.mock.calls[0]![0])).searchParams.get('fields')).toContain(
      'icu_efficiency_factor',
    );
  });

  it('rejects overlap, excessive ranges/settings/IDs and missing timezone before upstream access', async () => {
    const upstream = vi.fn<typeof fetch>(fixtureFetch());
    const s = service(upstream);
    await expect(s.compare({ ...compare, baseline: range })).rejects.toThrow('overlap');
    await expect(
      s.efficiency({ start_date: '2026-01-01', end_date: '2026-12-31' }),
    ).rejects.toThrow('90');
    await expect(service(upstream, '').compare(compare)).rejects.toThrow('timezone');
    expect(() => analyticsInputs.workouts.parse({ ...range, limit: 21 })).toThrow();
    expect(() =>
      analyticsInputs.workouts.parse({
        ...range,
        settings: { max_duration_difference_fraction: -1 },
      }),
    ).toThrow();
    expect(() =>
      analyticsInputs.efficiency.parse({ ...range, steady_aerobic_activity_ids: ['a', 'a'] }),
    ).toThrow();
    expect(() =>
      analyticsInputs.efficiency.parse({
        ...range,
        steady_aerobic_activity_ids: Array.from({ length: 101 }, (_, i) => `a${i}`),
      }),
    ).toThrow();
    expect(upstream).not.toHaveBeenCalled();
  });

  it('reports saturation, null totals and bounded decision output instead of a false complete aggregate', async () => {
    const source = fixtureFetch();

    const upstream: typeof fetch = async (input, init) =>
      requestUrl(input).includes('/activities')
        ? Response.json(
            Array.from({ length: 1001 }, (_, id) => ({
              id: `a${id}`,
              type: 'Run',
              start_date_local: '2026-11-12T08:00:00',
              distance: 1000,
              moving_time: 300,
              icu_training_load: 10,
            })),
          )
        : source(input, init);

    const result = await service(upstream).compare(compare);
    expect(result.analysis.current.metrics.distance_m.value).toBeNull();
    expect(result.analysis.current.data_quality).toMatchObject({
      completeness: 'partial',
      decisions_truncated: true,
    });
    expect(result.analysis.current.data_quality.decisions).toHaveLength(100);
    expect(JSON.stringify(result).length).toBeLessThan(80000);
  });

  it('propagates upstream failure and invalid response rather than returning a fabricated analytical result', async () => {
    await expect(
      service(async () => new Response('private', { status: 401 })).efficiency(range),
    ).rejects.toMatchObject({ category: 'upstream_unauthorized' });
    await expect(
      service(async () => Response.json({ wrong: 'shape' })).workouts(range),
    ).rejects.toMatchObject({ category: 'invalid_response' });
  });
});
