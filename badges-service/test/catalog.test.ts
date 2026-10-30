/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Tests for catalog seeding and loading.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { describe, expect, it } from 'vitest';
import catalogSeed from '../src/catalog/badges.json' with { type: 'json' };
import { loadCatalog, seedCatalog } from '../src/services/catalog.service.js';
import type { BadgeDefinition } from '../src/types.js';

const seed = catalogSeed as BadgeDefinition[];

describe('catalog', () => {
  it('loads the seeded catalog in display order', async () => {
    const catalog = await loadCatalog();
    expect(catalog.map((b) => b.badgeId)).toEqual(seed.map((b) => b.badgeId));
  });

  it('updates an existing badge when the seed changes, without a code change', async () => {
    const [first] = seed;
    await seedCatalog([{ ...first!, title: 'Renamed', conditions: [{ metric: 'completedDeliveries', op: 'gte', value: 2 }] }]);
    const updated = (await loadCatalog()).find((b) => b.badgeId === first!.badgeId);
    expect(updated).toMatchObject({ title: 'Renamed', conditions: [{ metric: 'completedDeliveries', op: 'gte', value: 2 }] });
  });

  it('leaves out progressMetric when a badge has none, and accepts an empty seed', async () => {
    const { progressMetric: _unused, ...plain } = seed[0]!;
    await seedCatalog([{ ...plain, badgeId: 'plain', displayOrder: 99 }]);
    await seedCatalog([]);
    const loaded = (await loadCatalog()).find((b) => b.badgeId === 'plain');
    expect(loaded).toBeDefined();
    expect(loaded).not.toHaveProperty('progressMetric');
  });
});
