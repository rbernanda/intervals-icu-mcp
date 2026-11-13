import type { CalendarEntry } from '../domain/models';
import { inRange, type DateRange } from '../utils/dates';
import { AppError } from '../utils/errors';
import type { SourceActivity, SourceEvent } from './schemas';

function requiredLocalDate(timestamp: string | null | undefined): string {
  if (!timestamp) {
    throw new AppError('invalid_response', 'Calendar records must include a local date.');
  }
  return timestamp.slice(0, 10);
}

function completedEntry(activity: SourceActivity, event?: SourceEvent): CalendarEntry {
  return {
    date: requiredLocalDate(activity.start_date_local),
    event_id: event?.id ?? null,
    activity_id: activity.id,
    name: activity.name ?? event?.name ?? null,
    sport_type: activity.type ?? null,
    category: event?.category ?? null,
    status: 'completed',
    planned_duration_s: event?.moving_time ?? null,
    planned_distance_m: event?.distance ?? null,
    planned_training_load: event?.icu_training_load ?? null,
    actual_duration_s: activity.moving_time ?? null,
    actual_elapsed_time_s: activity.elapsed_time ?? null,
    actual_distance_m: activity.distance ?? null,
    actual_training_load: activity.icu_training_load ?? null,
  };
}

function plannedEntry(event: SourceEvent): CalendarEntry {
  return {
    date: requiredLocalDate(event.start_date_local),
    event_id: event.id,
    activity_id: null,
    name: event.name ?? null,
    sport_type: event.type ?? null,
    category: event.category ?? null,
    status: event.category === 'WORKOUT' ? 'planned' : 'calendar_event',
    planned_duration_s: event.moving_time ?? null,
    planned_distance_m: event.distance ?? null,
    planned_training_load: event.icu_training_load ?? null,
    actual_duration_s: null,
    actual_elapsed_time_s: null,
    actual_distance_m: null,
    actual_training_load: null,
  };
}

/** Completion comes from an activity record; dates alone never complete a planned workout. */
export function buildTrainingCalendar(
  activities: SourceActivity[],
  events: SourceEvent[],
  range: DateRange,
): CalendarEntry[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const pairedIds = new Set<number>();
  const entries = activities.map((activity) => {
    const event =
      activity.paired_event_id == null ? undefined : eventsById.get(activity.paired_event_id);
    if (event) {
      pairedIds.add(event.id);
    }
    return completedEntry(activity, event);
  });

  for (const event of events) {
    if (pairedIds.has(event.id)) {
      continue;
    }
    const date = requiredLocalDate(event.start_date_local);
    if (inRange(date, range)) {
      entries.push(plannedEntry(event));
    }
  }

  return entries.sort((left, right) => left.date.localeCompare(right.date));
}
