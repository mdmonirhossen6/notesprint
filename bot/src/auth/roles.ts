import type { Database } from '../db/database.js';
import { nowSeconds } from '../lib/time.js';

export type AdminRole = 'super_admin' | 'admin' | 'moderator';

const ADMIN_ROLES: readonly AdminRole[] = ['super_admin', 'admin', 'moderator'];

function parseRole(value: string): AdminRole | null {
  return ADMIN_ROLES.includes(value as AdminRole) ? (value as AdminRole) : null;
}

export function getAdminRole(
  db: Database,
  tgId: number,
  superAdminId: number,
): AdminRole | null {
  if (tgId === superAdminId) return 'super_admin';

  const row = db
    .prepare('SELECT role FROM admins WHERE tg_id = ? AND is_active = 1')
    .get(tgId) as { role: string } | undefined;

  return row ? parseRole(row.role) : null;
}

export function isAdmin(db: Database, tgId: number, superAdminId: number): boolean {
  return getAdminRole(db, tgId, superAdminId) !== null;
}

export function ensureSuperAdmin(db: Database, superAdminId: number): void {
  db.prepare(`
    INSERT INTO admins (tg_id, role, granted_by, granted_at, is_active)
    VALUES (?, 'super_admin', NULL, ?, 1)
    ON CONFLICT(tg_id) DO UPDATE SET role = 'super_admin', is_active = 1
  `).run(superAdminId, nowSeconds());
}
