/**
 * AI Assistance Disclosure
 * Tool: Claude Code (Claude Opus 5.5), date: 2026-10-30
 * Scope: Ported catalog seeding and loading from the scaffold's db.ts to Drizzle.
 * Author review: Ngooi Jun Sen to validate before merge.
 */

import { asc, sql } from 'drizzle-orm';
import { db, type Executor } from '../database/index.js';
import { badgeCatalog } from '../database/schema.js';
import type { BadgeDefinition } from '../types.js';

/**
 * Upserts the catalog from src/catalog/badges.json, so a new badge or a changed
 * threshold needs no code change beyond the catalog data (F1.1).
 */
export async function seedCatalog(definitions: BadgeDefinition[], executor: Executor = db): Promise<void> {
  if (definitions.length === 0) return;
  await executor
    .insert(badgeCatalog)
    .values(
      definitions.map((badge) => ({
        badgeId: badge.badgeId,
        title: badge.title,
        description: badge.description,
        targetRole: badge.targetRole,
        displayOrder: badge.displayOrder,
        iconEarnedUrl: badge.iconEarnedUrl,
        iconUnearnedUrl: badge.iconUnearnedUrl,
        conditions: badge.conditions,
        progressMetric: badge.progressMetric ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: badgeCatalog.badgeId,
      set: {
        title: sql`excluded.title`,
        description: sql`excluded.description`,
        targetRole: sql`excluded.target_role`,
        displayOrder: sql`excluded.display_order`,
        iconEarnedUrl: sql`excluded.icon_earned_url`,
        iconUnearnedUrl: sql`excluded.icon_unearned_url`,
        conditions: sql`excluded.conditions`,
        progressMetric: sql`excluded.progress_metric`,
        updatedAt: sql`now()`,
      },
    });
}

export async function loadCatalog(executor: Executor = db): Promise<BadgeDefinition[]> {
  const rows = await executor.select().from(badgeCatalog).orderBy(asc(badgeCatalog.displayOrder));
  return rows.map((row) => ({
    badgeId: row.badgeId,
    title: row.title,
    description: row.description,
    targetRole: row.targetRole,
    displayOrder: row.displayOrder,
    iconEarnedUrl: row.iconEarnedUrl,
    iconUnearnedUrl: row.iconUnearnedUrl,
    conditions: row.conditions,
    ...(row.progressMetric !== null && { progressMetric: row.progressMetric }),
  }));
}
