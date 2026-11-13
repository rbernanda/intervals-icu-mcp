import { requestUrl } from '../helpers';

export const athlete = {
  id: 'i123',
  name: 'Test Runner',
  timezone: 'Asia/Jakarta',
  icu_weight: 60,
  icu_api_key: 'MUST-NOT-LEAK',
  email: 'private@example.com',
  sportSettings: [{ types: ['Run'], lthr: 170, threshold_pace: 4 }],
};

export const activities = [
  {
    id: 'a2',
    icu_athlete_id: 'i123',
    name: 'Long Run',
    type: 'Run',
    start_date_local: '2026-11-13T06:00:00',
    start_date: '2026-11-12T23:00:00Z',
    distance: 21000,
    moving_time: 6300,
    elapsed_time: 6500,
    average_speed: 10 / 3,
    average_heartrate: 145,
    max_heartrate: 165,
    average_cadence: 85,
    icu_average_watts: 200,
    total_elevation_gain: 150,
    icu_training_load: 120,
    paired_event_id: 10,
  },
  {
    id: 'a1',
    icu_athlete_id: 'i123',
    name: 'Easy trail',
    type: 'TrailRun',
    start_date_local: '2026-11-10T06:00:00',
    start_date: '2026-11-09T23:00:00Z',
    distance: 9000,
    moving_time: 3000,
    elapsed_time: 3200,
    average_speed: 3,
    icu_training_load: 50,
  },
  {
    id: 'a0',
    icu_athlete_id: 'i123',
    name: 'Ride',
    type: 'Ride',
    start_date_local: '2026-11-09T06:00:00',
    distance: 20000,
    moving_time: 3600,
    elapsed_time: 3700,
    icu_training_load: 40,
  },
];

export const wellness = [
  {
    id: '2026-11-13',
    ctl: 50,
    atl: 70,
    ctlLoad: 120,
    atlLoad: 118,
    rampRate: 2.5,
    restingHR: 45,
    sleepSecs: 28800,
    weight: 60,
    hrv: null,
    readiness: 80,
  },
];

export const events = [
  {
    id: 10,
    category: 'WORKOUT',
    type: 'Run',
    name: 'Long run planned',
    start_date_local: '2026-11-13T06:00:00',
    moving_time: 6000,
    distance: 20000,
    icu_training_load: 110,
  },
  {
    id: 11,
    category: 'WORKOUT',
    type: 'Run',
    name: 'Uncompleted past workout',
    start_date_local: '2026-11-11T06:00:00',
    moving_time: 1800,
  },
  { id: 12, category: 'NOTES', name: 'Rest', start_date_local: '2026-11-14T00:00:00' },
];

export const intervals = {
  id: 'a2',
  icu_intervals: [
    {
      id: 1,
      type: 'WORK',
      label: 'Lap 1',
      distance: 1000,
      moving_time: 300,
      average_speed: 10 / 3,
      average_cadence: 85,
    },
  ],
};

export function fixtureFetch(): typeof fetch {
  return async (input) => {
    const url = new URL(requestUrl(input));
    if (url.pathname.endsWith('/activities')) {
      return Response.json(activities);
    }
    if (url.pathname.endsWith('/wellness')) {
      return Response.json(wellness);
    }
    if (url.pathname.endsWith('/events')) {
      return Response.json(events);
    }
    if (url.pathname.endsWith('/intervals')) {
      return Response.json(intervals);
    }
    if (url.pathname.startsWith('/api/v1/activity/')) {
      return Response.json(activities[0]);
    }
    if (url.pathname === '/api/v1/athlete/0') {
      return Response.json(athlete);
    }
    throw new Error('Unexpected fixture request');
  };
}
