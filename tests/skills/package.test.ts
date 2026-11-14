import { mkdtemp, cp, mkdir, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  parseSkillMetadata,
  SKILL_NAME,
  validateSkillPackage,
} from '../../scripts/lib/skill-package';
import { createWorker } from '../../src/index';
import { fixtureFetch } from '../fixtures/data';
import { context, issueToken, testEnv } from '../helpers';
import { mockService, mockToolMethods } from './mock-tools';
import { inputs } from '../../src/tools/contracts';
import { checkRange, mondayOf, shiftDate, todayInTimezone } from '../../src/utils/dates';
import scenarios from './scenarios.json';
import { publicationSymlinkProblems } from '../../scripts/lib/publication';

describe('distributable training analyst skill', () => {
  it('allows only canonical discovery links, never aliases to ignored credentials or state', () => {
    expect(
      publicationSymlinkProblems(`.agents/skills/${SKILL_NAME}`, `../../skills/${SKILL_NAME}`),
    ).toEqual([]);
    expect(
      publicationSymlinkProblems(`.claude/skills/${SKILL_NAME}`, `../../skills/${SKILL_NAME}`),
    ).toEqual([]);
    for (const [path, target] of [
      ['credentials', '.dev.vars'],
      ['state', '.wrangler'],
      [`.agents/skills/${SKILL_NAME}`, '../../.dev.vars'],
    ]) {
      expect(publicationSymlinkProblems(path!, target!)).not.toEqual([]);
    }
  });

  it('validates YAML, portable links, templates and canonical Codex symlink', async () => {
    expect(await validateSkillPackage(process.cwd())).toHaveLength(11);
  });

  it.each([
    'Missing frontmatter',
    '---\nname: intervals-training-analyst\nname: duplicate\ndescription: valid\nlicense: MIT\n---\nBody',
    '---\nname: different\ndescription: valid\nlicense: MIT\n---\nBody',
    '---\nname: intervals-training-analyst\ndescription: ""\nlicense: MIT\n---\nBody',
  ])('rejects malformed, duplicate or invalid skill metadata: %s', (markdown) => {
    expect(() => parseSkillMetadata(markdown)).toThrow();
  });

  it('detects a missing linked template in a relocated package', async () => {
    const root = await mkdtemp(join(tmpdir(), 'intervals-skill-'));
    try {
      const canonical = join(root, 'skills', SKILL_NAME);
      await mkdir(join(root, '.agents/skills'), { recursive: true });
      await cp(join(process.cwd(), 'skills', SKILL_NAME), canonical, { recursive: true });
      await symlink(`../../skills/${SKILL_NAME}`, join(root, '.agents/skills', SKILL_NAME));
      expect(await validateSkillPackage(root)).toHaveLength(11);
      await rm(join(canonical, 'assets/templates/weekly-review.md'));
      await expect(validateSkillPackage(root)).rejects.toThrow('Missing skill resource');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('maps exactly the real registered read-only MCP tools, not proposed names', async () => {
    const env = testEnv();
    const { access_token } = await issueToken(env);
    const worker = createWorker(fixtureFetch(), () => {});
    const client = new Client({ name: 'skill-contract-test', version: '1' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${env.PUBLIC_ORIGIN}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${access_token}` } },
          fetch: async (input, init) => worker.fetch(new Request(input, init), env, context()),
        }),
      );
      const discovered = (await client.listTools()).tools;
      const mapping = await readFile(
        'skills/intervals-training-analyst/references/mcp-tool-mapping.md',
        'utf8',
      );
      const documented = [
        ...new Set(
          [...mapping.matchAll(/`((?:get|compare|analyze)_[a-z_]+)`/g)].map((match) => match[1]),
        ),
      ].sort();
      expect(documented).toEqual(discovered.map((tool) => tool.name).sort());
      expect(Object.keys(mockToolMethods).sort()).toEqual(documented);
      expect(discovered.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    } finally {
      await client.close();
    }
  });
});

describe('synthetic evaluation fixtures and boundary arithmetic', () => {
  it('resolves DST-adjacent athlete date and matched calendar weeks correctly', () => {
    const today = todayInTimezone(new Date(scenarios.now), scenarios.timezone);
    expect(today).toBe('2026-03-08');
    expect(mondayOf(today)).toBe('2026-03-02');
    expect(shiftDate(today, -6)).toBe('2026-03-02');
    expect(shiftDate(mondayOf(today), -7)).toBe('2026-02-23');
    expect(checkRange({ start_date: '2026-02-23', end_date: today })).toBeDefined();
    expect(() => checkRange({ start_date: '2025-11-01', end_date: today })).toThrow();
    expect(() => inputs.summary.parse({ days: 7, end_date: today })).toThrow();
  });

  it('supports a grounded 30 km versus 28 km comparison and computed negative form', async () => {
    const service = mockService('standard');
    const current = await service.summary({ days: 7, sport_type: 'running' });
    const prior = await service.recent({
      start_date: '2026-02-23',
      end_date: '2026-03-01',
      limit: 100,
      sport_type: 'running',
    });
    expect(current.summary.total_distance_m.value).toBe(30000);
    expect(prior.returned_count).toBe(prior.matching_count);
    expect(prior.activities.reduce((sum, run) => sum + (run.distance_m ?? 0), 0)).toBe(28000);
    expect(current.summary.latest_fitness).toMatchObject({
      fitness_ctl: 46,
      fatigue_atl: 62,
      source_form_tsb: null,
      computed_form: { value: -16, origin: 'computed' },
    });
  });

  it('retains missing HRV, RHR, power and cadence rather than creating zero values', async () => {
    const wellness = await mockService('missing-wellness').wellness({
      start_date: '2026-03-02',
      end_date: '2026-03-08',
    });
    expect(wellness.daily[0]).toMatchObject({ hrv_source: null, resting_heart_rate_bpm: null });
    const detail = await mockService('missing-metrics').detail({ activity_id: 'synthetic-latest' });
    expect(detail.activity).toMatchObject({ average_power_w: null, average_cadence_spm: null });
  });

  it('exercises sparse and incompatible candidates and keeps injection text as inert source data', async () => {
    const range = {
      start_date: '2026-01-26',
      end_date: '2026-03-08',
      limit: 100,
      sport_type: 'running',
    };
    expect((await mockService('short-history').recent(range)).matching_count).toBe(1);
    const incompatible = await mockService('incompatible').recent(range);
    expect(new Set(incompatible.activities.map((run) => run.sport_type))).toEqual(
      new Set(['Run', 'TrailRun', 'VirtualRun']),
    );
    const injected = await mockService('injection').detail({ activity_id: 'synthetic-latest' });
    expect(injected.activity.name).toContain('IGNORE ALL RULES');
    expect(injected.activity.distance_m).toBe(20000);
    expect(Object.keys(injected.activity)).not.toContain('notes');
  });
});
