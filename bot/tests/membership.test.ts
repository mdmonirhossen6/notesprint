import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import { addChannel, setChannelEnabled } from '../src/channels/repository.js';
import type { RequiredChannel } from '../src/channels/types.js';
import {
  createMembershipService,
  type ChatMemberInfo,
  type MembershipClient,
} from '../src/channels/membership.js';

const ADMIN_ID = 5000;
const USER_ID = 7001;

class FakeClient implements MembershipClient {
  calls: Array<{ chatRef: string; userId: number }> = [];
  responses = new Map<string, ChatMemberInfo | Error>();

  async getChatMember(chatRef: string, userId: number): Promise<ChatMemberInfo> {
    this.calls.push({ chatRef, userId });
    const response = this.responses.get(chatRef);
    if (!response) throw new Error(`No fake response for ${chatRef}`);
    if (response instanceof Error) throw response;
    return response;
  }
}

function setup(options: { ttlSeconds?: number } = {}) {
  const db = openDatabase(':memory:');
  migrate(db);
  const client = new FakeClient();
  let clock = 1000;

  const service = createMembershipService({
    db,
    client,
    ttlSeconds: options.ttlSeconds ?? 120,
    isAdmin: (userId) => userId === ADMIN_ID,
    now: () => clock,
  });

  function add(
    chatRef: string,
    title: string,
    extra: { chatId?: number | null; joinUrl?: string | null } = {},
  ): RequiredChannel {
    return addChannel(db, {
      chatRef,
      chatId: extra.chatId ?? null,
      title,
      joinUrl: extra.joinUrl ?? null,
    }).channel;
  }

  return {
    db,
    client,
    service,
    add,
    advance(seconds: number) {
      clock += seconds;
    },
    get clock() {
      return clock;
    },
  };
}

test('verifies a public channel membership', async () => {
  const ctx = setup();
  ctx.add('@prostutibd', 'Prostuti BD');
  ctx.client.responses.set('@prostutibd', { status: 'member' });

  const summary = await ctx.service.check(USER_ID);
  assert.equal(summary.allJoined, true);
  assert.equal(summary.adminBypass, false);
  assert.equal(summary.channels.length, 1);
  assert.equal(summary.channels[0]?.isMember, true);
  assert.equal(summary.channels[0]?.cached, false);
  assert.deepEqual(ctx.client.calls, [{ chatRef: '@prostutibd', userId: USER_ID }]);
  ctx.db.close();
});

test('verifies a private numeric channel membership', async () => {
  const ctx = setup();
  ctx.add('-1001234567890', 'Private channel', {
    chatId: -1001234567890,
    joinUrl: 'https://t.me/+fspkwHqVmdcyNjI1',
  });
  ctx.client.responses.set('-1001234567890', { status: 'administrator' });

  const summary = await ctx.service.check(USER_ID);
  assert.equal(summary.allJoined, true);
  assert.equal(summary.channels[0]?.channel.chatRef, '-1001234567890');
  ctx.db.close();
});

test('requires every enabled channel and reports the missing ones', async () => {
  const ctx = setup();
  ctx.add('@prostutibd', 'Prostuti BD');
  ctx.add('@admissionfreepdf', 'Admission Free PDF');
  ctx.client.responses.set('@prostutibd', { status: 'member' });
  ctx.client.responses.set('@admissionfreepdf', { status: 'left' });

  const summary = await ctx.service.check(USER_ID);
  assert.equal(summary.allJoined, false);
  assert.equal(summary.missing.length, 1);
  assert.equal(summary.missing[0]?.channel.chatRef, '@admissionfreepdf');
  ctx.db.close();
});

test('treats restricted members correctly', async () => {
  const ctx = setup();
  ctx.add('@prostutibd', 'Prostuti BD');

  ctx.client.responses.set('@prostutibd', { status: 'restricted', is_member: true });
  assert.equal((await ctx.service.check(USER_ID)).allJoined, true);

  ctx.client.responses.set('@prostutibd', { status: 'restricted', is_member: false });
  assert.equal((await ctx.service.check(USER_ID, { force: true })).allJoined, false);
  ctx.db.close();
});

test('ignores disabled channels and allows access when none are enabled', async () => {
  const ctx = setup();
  const channel = ctx.add('@prostutibd', 'Prostuti BD');
  setChannelEnabled(ctx.db, channel.id, false);

  const summary = await ctx.service.check(USER_ID);
  assert.equal(summary.allJoined, true);
  assert.equal(summary.channels.length, 0);
  assert.equal(ctx.client.calls.length, 0);
  ctx.db.close();
});

test('administrators bypass the channel check without API calls', async () => {
  const ctx = setup();
  ctx.add('@prostutibd', 'Prostuti BD');

  const summary = await ctx.service.check(ADMIN_ID);
  assert.equal(summary.adminBypass, true);
  assert.equal(summary.allJoined, true);
  assert.equal(ctx.client.calls.length, 0);
  assert.equal((await ctx.service.check(ADMIN_ID)).allJoined, true);
  ctx.db.close();
});

test('caches membership results for the configured TTL and refreshes when forced', async () => {
  const ctx = setup({ ttlSeconds: 180 });
  ctx.add('@prostutibd', 'Prostuti BD');
  ctx.client.responses.set('@prostutibd', { status: 'member' });

  await ctx.service.check(USER_ID);
  assert.equal(ctx.client.calls.length, 1);

  const cached = await ctx.service.check(USER_ID);
  assert.equal(ctx.client.calls.length, 1);
  assert.equal(cached.channels[0]?.cached, true);

  ctx.advance(60);
  await ctx.service.check(USER_ID);
  assert.equal(ctx.client.calls.length, 1);

  ctx.advance(120);
  await ctx.service.check(USER_ID);
  assert.equal(ctx.client.calls.length, 2);

  await ctx.service.check(USER_ID, { force: true });
  assert.equal(ctx.client.calls.length, 3);
  ctx.db.close();
});

test('failed verification is not cached and fails closed', async () => {
  const ctx = setup();
  ctx.add('@prostutibd', 'Prostuti BD');
  ctx.client.responses.set('@prostutibd', new Error('Bad Request: chat not found'));

  const first = await ctx.service.check(USER_ID);
  assert.equal(first.allJoined, false);
  assert.equal(first.hasUnavailable, true);
  assert.equal(first.channels[0]?.unavailable, true);

  const rows = ctx.db.prepare('SELECT COUNT(*) AS total FROM membership_cache').get() as {
    total: number;
  };
  assert.equal(rows.total, 0);

  await ctx.service.check(USER_ID);
  assert.equal(ctx.client.calls.length, 2);
  ctx.db.close();
});

test('unknown member statuses are treated as unavailable', async () => {
  const ctx = setup();
  ctx.add('@prostutibd', 'Prostuti BD');
  ctx.client.responses.set('@prostutibd', { status: 'mystery' });

  const summary = await ctx.service.check(USER_ID);
  assert.equal(summary.allJoined, false);
  assert.equal(summary.channels[0]?.unavailable, true);
  ctx.db.close();
});

test('invalidate clears cached membership for one user or everyone', async () => {
  const ctx = setup();
  ctx.add('@prostutibd', 'Prostuti BD');
  ctx.client.responses.set('@prostutibd', { status: 'member' });

  await ctx.service.check(USER_ID);
  await ctx.service.check(USER_ID);
  assert.equal(ctx.client.calls.length, 1);

  ctx.service.invalidate(USER_ID);
  await ctx.service.check(USER_ID);
  assert.equal(ctx.client.calls.length, 2);

  ctx.service.invalidate();
  await ctx.service.check(USER_ID);
  assert.equal(ctx.client.calls.length, 3);
  ctx.db.close();
});
