import { describe, expect, it } from 'vitest';
import { buildTrainingCalendar } from '../../src/intervals/calendar';

const range = { start_date: '2026-11-01', end_date: '2026-11-14' };

describe('calendar record integrity', () => {
  it('rejects completed records without dates rather than asserting they exist', () => {
    expect(() => buildTrainingCalendar([{ id: 'synthetic-run', type: 'Run' }], [], range)).toThrow(
      'Calendar records must include a local date.',
    );
  });

  it('rejects undated planned records rather than silently omitting them', () => {
    expect(() => buildTrainingCalendar([], [{ id: 1, category: 'WORKOUT' }], range)).toThrow(
      'Calendar records must include a local date.',
    );
  });

  it('does not pair records by matching names and dates', () => {
    const timestamp = '2026-11-13T06:00:00';
    const entries = buildTrainingCalendar(
      [{ id: 'synthetic-run', type: 'Run', name: 'Easy run', start_date_local: timestamp }],
      [{ id: 1, category: 'WORKOUT', name: 'Easy run', start_date_local: timestamp }],
      range,
    );
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.activity_id === 'synthetic-run')).toMatchObject({
      status: 'completed',
      event_id: null,
    });
    expect(entries.find((entry) => entry.event_id === 1)).toMatchObject({
      status: 'planned',
      activity_id: null,
    });
  });
});
