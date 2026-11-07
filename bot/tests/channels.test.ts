import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import { migration001 } from '../src/db/migrations/001_init.js';
import {
  addChannel,
  countChannels,
  findChannelByRef,
  getChannel,
  listChannels,
  removeChannel,
  setChannelEnabled,
} from '../src/channels/repository.js';
import { DEFAULT_CHANNELS, seedDefaultChannels } from '../src/channels/seed.js';
import { parseChannelRef, parseJoinUrl } from '../src/channels/validation.js';
import { createAdminInputStore } from '../src/bot/admin-input.js';

function freshDb() {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

test('accepts @usernames and numeric private channel IDs', () => {
  const username = parseChannelRef('@ProstutiBD');
  assert.equal(username.ok, true);
  if (username.ok) {
    assert.equal(username.value.kind, 'username');
    assert.equal(username.value.ref, '@prostutibd');
  }

  const bare = parseChannelRef('admissionfreepdf');
  assert.equal(bare.ok, true);
  if (bare.ok) assert.equal(bare.value.ref, '@admissionfreepdf');

  const numeric = parseChannelRef('-1001234567890');
  assert.equal(numeric.ok, true);
  if (numeric.ok) {
    assert.equal(numeric.value.kind, 'id');
    assert.equal(numeric.value.chatId, -1001234567890);
  }
});

test('rejects invite links and invalid chat IDs', () => {
  for (const input of [
    'https://t.me/+fspkwHqVmdcyNjI1',
    'https://t.me/prostutibd',
    't.me/joinchat/abc12345678',
    '+fspkwHqVmdcyNjI1',
    '1001234567890',
    '0',
    'not a channel',
  ]) {
    const parsed = parseChannelRef(input);
    assert.equal(parsed.ok, false, `expected rejection for ${input}`);
    if (!parsed.ok) assert.match(parsed.error, /chat ID|link|valid/i);
  }
});

test('validates t.me join URLs', () => {
  const invite = parseJoinUrl('https://t.me/+fspkwHqVmdcyNjI1');
  assert.equal(invite.ok, true);
  if (invite.ok) assert.equal(invite.value, 'https://t.me/+fspkwHqVmdcyNjI1');

  const publicLink = parseJoinUrl('t.me/prostutibd');
  assert.equal(publicLink.ok, true);
  if (publicLink.ok) assert.equal(publicLink.value, 'https://t.me/prostutibd');

  for (const input of [
    'https://example.com/+abc12345678',
    'http://t.me/+abc12345678',
    'https://t.me/',
    'https://t.me/foo/bar',
    '',
  ]) {
    assert.equal(parseJoinUrl(input).ok, false, `expected rejection for ${input}`);
  }
});

test('migration 002 preserves an existing numeric channel row', () => {
  const db = openDatabase(':memory:');
  db.exec(`
    CREATE TABLE schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
  db.exec(migration001.sql);
  db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (1, ?, ?)').run(
    'initial_schema',
    1000,
  );
  db.prepare(`
    INSERT INTO required_channels (chat_id, title, join_url, is_enabled, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(-1001234567890, 'Old private channel', 'https://t.me/+fspkwHqVmdcyNjI1', 1000);

  assert.equal(migrate(db).applied, 1);

  const channel = findChannelByRef(db, '-1001234567890');
  assert.ok(channel);
  assert.equal(channel.chatRef, '-1001234567890');
  assert.equal(channel.chatId, -1001234567890);
  assert.equal(channel.title, 'Old private channel');
  db.close();
});

test('channel repository adds, lists, toggles and removes channels', () => {
  const db = freshDb();

  const added = addChannel(db, {
    chatRef: '@ProstutiBD',
    chatId: null,
    title: 'Prostuti BD',
    joinUrl: 'https://t.me/prostutibd',
  });
  assert.equal(added.created, true);
  assert.equal(added.channel.chatRef, '@prostutibd');
  assert.equal(added.channel.isEnabled, true);

  const duplicate = addChannel(db, {
    chatRef: '@prostutibd',
    chatId: null,
    title: 'Duplicate',
    joinUrl: null,
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.channel.title, 'Prostuti BD');

  addChannel(db, {
    chatRef: '-1001234567890',
    chatId: -1001234567890,
    title: 'Private channel',
    joinUrl: 'https://t.me/+fspkwHqVmdcyNjI1',
  });

  assert.equal(listChannels(db).length, 2);
  assert.deepEqual(countChannels(db), { total: 2, enabled: 2 });

  const paused = setChannelEnabled(db, added.channel.id, false);
  assert.equal(paused?.isEnabled, false);
  assert.equal(listChannels(db, { enabledOnly: true }).length, 1);
  assert.deepEqual(countChannels(db), { total: 2, enabled: 1 });

  db.prepare('INSERT INTO membership_cache (user_id, channel_ref, is_member, checked_at) VALUES (?, ?, 1, ?)').run(
    9001,
    '@prostutibd',
    1000,
  );

  const removed = removeChannel(db, added.channel.id);
  assert.equal(removed?.chatRef, '@prostutibd');
  assert.equal(getChannel(db, added.channel.id), null);
  const cache = db
    .prepare('SELECT COUNT(*) AS total FROM membership_cache WHERE channel_ref = ?')
    .get('@prostutibd') as { total: number };
  assert.equal(cache.total, 0);

  db.close();
});

test('pending admin input expires after five minutes', () => {
  let clock = 1000;
  const store = createAdminInputStore(300, () => clock);

  store.set(42, { kind: 'channel_add' });
  assert.equal(store.get(42)?.kind, 'channel_add');

  clock = 1299;
  assert.equal(store.get(42)?.kind, 'channel_add');

  clock = 1300;
  assert.equal(store.get(42), null);
});

test('default channels are seeded once with join links', () => {
  const db = freshDb();

  assert.equal(DEFAULT_CHANNELS.length, 2);
  assert.deepEqual(seedDefaultChannels(db, 1000), { seeded: 2 });
  assert.deepEqual(seedDefaultChannels(db, 2000), { seeded: 0 });

  const channels = listChannels(db);
  assert.deepEqual(
    channels.map((channel) => channel.chatRef),
    ['@prostutibd', '@admissionfreepdf'],
  );
  assert.equal(channels[0]?.joinUrl, 'https://t.me/prostutibd');
  assert.equal(channels[1]?.joinUrl, 'https://t.me/admissionfreepdf');
  db.close();
});
