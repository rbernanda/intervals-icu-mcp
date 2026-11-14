import { describe, expect, it } from 'vitest';
import { resolveContext, validatePeriods } from '../../src/analytics/data-quality';
import { summarizePeriod } from '../../src/analytics/training-load';
import { daysBetween } from '../../src/utils/dates';
import { context, run } from './fixtures';

describe('explicit athlete-local calendar periods', () => {
  it.each([
    ['2026-03-09T00:30:00Z', 'America/New_York', '2026-03-08'],
    ['2026-03-08T06:59:59Z', 'America/New_York', '2026-03-08'],
    ['2026-03-08T07:00:00Z', 'America/New_York', '2026-03-08'],
    ['2026-11-01T05:30:00Z', 'America/New_York', '2026-11-01'],
    ['2026-11-01T06:30:00Z', 'America/New_York', '2026-11-01'],
    ['2026-03-08T17:00:00Z', 'Asia/Jakarta', '2026-03-09'],
  ])('resolves %s in %s without system timezone assumptions', (instant, timezone, today) => {
    expect(resolveContext(context.range, timezone, new Date(instant)).today).toBe(today);
  });

  it('counts inclusive dates across daylight-saving changes and midnight boundaries', () => {
    const c = resolveContext(
      { start_date: '2026-03-07', end_date: '2026-03-09' },
      'America/New_York',
      new Date('2026-03-10T12:00:00Z'),
    );
    const result = summarizePeriod(
      [
        run('a', { start_local: '2026-03-07T00:00:00', start_timestamp: '2026-03-07T05:00:00Z' }),
        run('b', { start_local: '2026-03-09T23:59:59', start_timestamp: '2026-03-10T03:59:59Z' }),
        run('c', { start_local: '2026-03-10T00:00:00' }),
      ],
      [],
      c,
    );
    expect(result.inclusive_days).toBe(3);
    expect(result.metrics.activity_count.value).toBe(2);
    expect(result.data_quality.actual_activity_range).toEqual(c.range);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });

  it.each(['', 'Missing/Timezone'])('rejects unavailable timezone %s', (timezone) => {
    expect(() => resolveContext(context.range, timezone, new Date())).toThrow('timezone');
  });

  it('rejects invalid, reversed, too-long and inclusively overlapping periods', () => {
    for (const current of [
      { start_date: '2026-02-30', end_date: '2026-03-01' },
      { start_date: '2026-02-28', end_date: '2026-02-01' },
      { start_date: '2026-01-01', end_date: '2026-05-01' },
      { start_date: '2026-02-28', end_date: '2026-03-04' },
    ]) {
      expect(() => validatePeriods(current, context.range)).toThrow();
    }
    expect(() =>
      validatePeriods({ start_date: '2026-03-01', end_date: '2026-03-07' }, context.range),
    ).not.toThrow();
  });

  it('marks current days and future dates explicitly rather than certifying completed coverage', () => {
    const result = summarizePeriod([], [], {
      ...context,
      today: '2026-02-27',
      coverage: { inventory: 'verified', saturated: false },
    });
    expect(result.data_quality).toMatchObject({
      current_day_included: true,
      future_days_included: true,
      completeness: 'uncertain',
      empty_status: 'no_activities_returned',
    });
  });
});
