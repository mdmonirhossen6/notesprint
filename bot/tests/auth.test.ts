import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import { ensureSuperAdmin, getAdminRole, isAdmin } from '../src/auth/roles.js';

const SUPER_ADMIN = 5000;

function freshDb() {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

function addAdmin(db: ReturnType<typeof freshDb>, tgId: number, role: string, active = 1) {
  db.prepare(
    'INSERT INTO admins (tg_id, role, granted_by, granted_at, is_active) VALUES (?, ?, ?, ?, ?)',
  ).run(tgId, role, SUPER_ADMIN, 1000, active);
}

test('super admin comes from config even with an empty admins table', () => {
  const db = freshDb();
  assert.equal(getAdminRole(db, SUPER_ADMIN, SUPER_ADMIN), 'super_admin');
  assert.equal(isAdmin(db, SUPER_ADMIN, SUPER_ADMIN), true);
  db.close();
});

test('database admins and moderators are recognized', () => {
  const db = freshDb();
  addAdmin(db, 6001, 'admin');
  addAdmin(db, 6002, 'moderator');

  assert.equal(getAdminRole(db, 6001, SUPER_ADMIN), 'admin');
  assert.equal(getAdminRole(db, 6002, SUPER_ADMIN), 'moderator');
  assert.equal(getAdminRole(db, 6003, SUPER_ADMIN), null);
  db.close();
});

test('inactive admins lose access', () => {
  const db = freshDb();
  addAdmin(db, 6001, 'admin', 0);
  assert.equal(getAdminRole(db, 6001, SUPER_ADMIN), null);
  db.close();
});

test('seeding the super admin is idempotent and keeps the role', () => {
  const db = freshDb();
  ensureSuperAdmin(db, SUPER_ADMIN);
  ensureSuperAdmin(db, SUPER_ADMIN);

  const rows = db.prepare('SELECT role, is_active FROM admins WHERE tg_id = ?').all(SUPER_ADMIN) as Array<{
    role: string;
    is_active: number;
  }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.role, 'super_admin');
  assert.equal(rows[0]?.is_active, 1);
  db.close();
});
