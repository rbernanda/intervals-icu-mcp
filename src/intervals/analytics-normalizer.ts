import { analyticsActivitySchema, type AnalyticsActivity } from '../analytics/contracts';
import { normalizeActivity } from './normalizers';
import type { SourceActivity } from './schemas';

/** Whitelists analytics additions; source EF/decoupling are never substituted for the speed/HR proxy. */
export function normalizeAnalyticsActivity(row: SourceActivity): AnalyticsActivity {
  return analyticsActivitySchema.parse({
    ...normalizeActivity(row),
    source_efficiency_factor: row.icu_efficiency_factor ?? null,
    source_decoupling: row.decoupling ?? null,
    trainer: row.trainer ?? null,
    source_sub_type: row.sub_type ?? null,
    ignore_hr: row.icu_ignore_hr ?? false,
  });
}
