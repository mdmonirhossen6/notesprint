import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, transaction } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import { countUsers, isBanned, upsertUser } from '../src/users/repository.js';

function freshDb() {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

const USER = {
  id: 1001,
  is_bot: false,
  first_name: 'Test',
  username: 'tester',
  language_code: 'en',
};

test('migrations run once and are idempotent', () => {
  const db = openDatabase(':memory:');
  assert.equal(migrate(db).applied, 2);
  assert.equal(migrate(db).applied, 0);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  const names = tables.map((table) => table.name);
  for (const required of [
    'users',
    'jobs',
    'pending_files',
    'approved_files',
    'required_channels',
    'membership_cache',
    'promotions',
    'campaign_events',
    'admins',
    'banned_users',
    'admin_logs',
    'settings',
  ]) {
    assert.ok(names.includes(required), `missing table ${required}`);
  }
  db.close();
});

test('user upsert inserts once and updates on repeat', () => {
  const db = freshDb();
  upsertUser(db, USER, 1000);
  upsertUser(db, { ...USER, username: 'renamed' }, 2000);

  const row = db.prepare('SELECT username, first_seen_at, last_seen_at FROM users WHERE tg_id = ?').get(
    USER.id,
  ) as { username: string; first_seen_at: number; last_seen_at: number };

  assert.equal(countUsers(db), 1);
  assert.equal(row.username, 'renamed');
  assert.equal(row.first_seen_at, 1000);
  assert.equal(row.last_seen_at, 2000);
  db.close();
});

test('banned users are detected', () => {
  const db = freshDb();
  upsertUser(db, USER);
  assert.equal(isBanned(db, USER.id), false);

  db.prepare('INSERT INTO banned_users (tg_id, reason, banned_at) VALUES (?, ?, ?)').run(
    USER.id,
    'spam',
    3000,
  );
  assert.equal(isBanned(db, USER.id), true);
  db.close();
});

test('transactions roll back on failure', () => {
  const db = freshDb();
  assert.throws(() =>
    transaction(db, () => {
      upsertUser(db, USER);
      throw new Error('boom');
    }),
  );
  assert.equal(countUsers(db), 0);
  db.close();
});
