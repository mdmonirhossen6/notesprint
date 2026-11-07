import type { Database } from '../db/database.js';
import { nowSeconds } from '../lib/time.js';

export type CampaignEvent = 'start' | 'click' | 'conversion';

export function recordCampaignEvent(
  db: Database,
  campaign: string,
  userId: number,
  event: CampaignEvent,
  at = nowSeconds(),
): void {
  db.prepare(
    'INSERT INTO campaign_events (campaign, user_id, event, created_at) VALUES (?, ?, ?, ?)',
  ).run(campaign, userId, event, at);
}
