import type { Database } from '../db/database.js';
import { nowSeconds } from '../lib/time.js';

export function logAdminAction(
  db: Database,
  adminId: number,
  action: string,
  target: string | null = null,
  detail: unknown = null,
  at = nowSeconds(),
): void {
  db.prepare(`
    INSERT INTO admin_logs (admin_id, action, target, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(adminId, action, target, detail === null ? null : JSON.stringify(detail), at);
}
