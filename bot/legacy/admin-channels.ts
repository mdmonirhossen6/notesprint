import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';
import { getAdminRole } from '../../auth/roles.js';
import { logAdminAction } from '../../admin/logs.js';
import {
  addChannel,
  getChannel,
  listChannels,
  removeChannel,
  setChannelEnabled,
} from '../../channels/repository.js';
import { parseChannelRef, parseJoinUrl } from '../../channels/validation.js';
import type { ChannelDraft, RequiredChannel } from '../../channels/types.js';
import type { BotDeps } from '../types.js';
import { editOrReply } from '../ui.js';
import { requireSuperAdmin } from '../middleware/admin.js';

const ADD_CHANNEL_TEXT = [
  '➕ Add required channel',
  '',
  'Send @username for a public channel, or the numeric -100… chat ID for a private channel.',
  '',
  'Invite links (https://t.me/+…) are join URLs, not chat IDs. They are rejected here.',
  '',
  'The bot must already be an administrator of the channel.',
  '',
  '/cancel to stop.',
].join('\n');

type ResolveResult = { ok: true; draft: ChannelDraft } | { ok: false; error: string };

function shortTitle(title: string): string {
  return title.length > 20 ? `${title.slice(0, 19)}…` : title;
}

function channelsText(channels: RequiredChannel[]): string {
  if (channels.length === 0) {
    return [
      'Required channels',
      '',
      'No channels configured. The bot is currently open to everyone.',
      '',
      'Add @prostutibd, @admissionfreepdf or a private channel with its numeric -100… chat ID.',
    ].join('\n');
  }

  const enabled = channels.filter((channel) => channel.isEnabled).length;
  const lines = [
    'Required channels',
    '',
    `${enabled} enabled / ${channels.length} total.`,
    'Users must join every enabled channel before using PDF tools.',
    '',
  ];

  channels.forEach((channel, index) => {
    lines.push(`${index + 1}. ${channel.isEnabled ? '✅' : '⏸'} ${channel.title}`);
    lines.push(`   Ref: ${channel.chatRef}`);
    if (channel.chatId !== null) lines.push(`   ID: ${channel.chatId}`);
    lines.push(`   Join: ${channel.joinUrl ?? 'not set'}`);
  });

  return lines.join('\n');
}

function channelsKeyboard(channels: RequiredChannel[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const channel of channels) {
    const action = channel.isEnabled ? 'Pause' : 'Enable';
    keyboard
      .text(`${action} · ${shortTitle(channel.title)}`, `admin:ch:tg:${channel.id}`)
      .text('Remove', `admin:ch:rm:${channel.id}`)
      .row();
  }

  keyboard.text('➕ Add channel', 'admin:ch:add').row();
  keyboard.text('Back', 'admin:home');
  return keyboard;
}

async function renderChannelList(ctx: Context, deps: BotDeps): Promise<void> {
  const channels = listChannels(deps.db);
  await editOrReply(ctx, channelsText(channels), channelsKeyboard(channels));
}

function matchId(ctx: Context): number | null {
  const match = ctx.match;
  if (!match || typeof match === 'string') return null;
  const raw = match[1];
  if (!raw) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

async function resolveChannel(bot: Bot, botId: number, input: string): Promise<ResolveResult> {
  const parsed = parseChannelRef(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const ref = parsed.value;

  let chat;
  try {
    chat = await bot.api.getChat(ref.ref);
  } catch {
    return {
      ok: false,
      error:
        'Telegram could not read that channel. Add the bot as an administrator of the channel, then try again.',
    };
  }

  if (chat.type !== 'channel' && chat.type !== 'supergroup') {
    return { ok: false, error: 'That chat is not a channel or supergroup.' };
  }

  try {
    const botMember = await bot.api.getChatMember(ref.ref, botId);
    if (botMember.status !== 'administrator' && botMember.status !== 'creator') {
      return {
        ok: false,
        error: 'The bot must be an administrator of the channel before it can be added.',
      };
    }
  } catch {
    return {
      ok: false,
      error:
        'Could not verify the bot administrator status. Add the bot as an administrator, then try again.',
    };
  }

  let joinUrl: string | null = null;
  if (ref.kind === 'username') {
    joinUrl = `https://t.me/${ref.username}`;
  } else if (chat.invite_link) {
    joinUrl = chat.invite_link;
  }

  return {
    ok: true,
    draft: {
      chatRef: ref.ref,
      chatId: chat.id,
      title: chat.title ?? ref.ref,
      joinUrl,
    },
  };
}

async function completeChannel(
  ctx: Context,
  deps: BotDeps,
  draft: ChannelDraft,
  adminId: number,
): Promise<void> {
  const { created, channel } = addChannel(deps.db, draft);

  deps.membership.invalidate();
  deps.adminInputs.clear(adminId);
  logAdminAction(
    deps.db,
    adminId,
    created ? 'channel_add' : 'channel_exists',
    channel.chatRef,
    {
      title: channel.title,
      chatId: channel.chatId,
      joinUrl: channel.joinUrl,
    },
  );

  const channels = listChannels(deps.db);
  const heading = created
    ? `✅ Added ${channel.title}.`
    : `That channel is already configured: ${channel.title}.`;

  await ctx.reply(`${heading}\n\n${channelsText(channels)}`, {
    reply_markup: channelsKeyboard(channels),
  });
}

export function registerChannelAdminHandlers(bot: Bot, deps: BotDeps): void {
  const { config, db, membership, adminInputs } = deps;
  const superOnly = requireSuperAdmin(config, db);

  bot.callbackQuery('admin:channels', superOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderChannelList(ctx, deps);
  });

  bot.callbackQuery('admin:ch:add', superOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    adminInputs.set(ctx.from.id, { kind: 'channel_add' });
    await editOrReply(
      ctx,
      ADD_CHANNEL_TEXT,
      new InlineKeyboard().text('Cancel', 'admin:ch:cancel'),
    );
  });

  bot.callbackQuery('admin:ch:cancel', superOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    adminInputs.clear(ctx.from.id);
    await renderChannelList(ctx, deps);
  });

  bot.callbackQuery(/^admin:ch:tg:\d+$/, superOnly, async (ctx) => {
    if (!ctx.from) return;

    const id = matchId(ctx);
    const channel = id === null ? null : getChannel(db, id);
    if (!channel) {
      await ctx.answerCallbackQuery({ text: 'Channel not found.', show_alert: true });
      return;
    }

    setChannelEnabled(db, channel.id, !channel.isEnabled);
    membership.invalidate();
    logAdminAction(db, ctx.from.id, 'channel_toggle', channel.chatRef, {
      enabled: !channel.isEnabled,
    });

    await ctx.answerCallbackQuery({
      text: channel.isEnabled ? 'Channel paused.' : 'Channel enabled.',
    });
    await renderChannelList(ctx, deps);
  });

  bot.callbackQuery(/^admin:ch:rm:\d+$/, superOnly, async (ctx) => {
    if (!ctx.from) return;

    const id = matchId(ctx);
    const channel = id === null ? null : getChannel(db, id);
    if (!channel) {
      await ctx.answerCallbackQuery({ text: 'Channel not found.', show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery();
    await editOrReply(
      ctx,
      [
        `Remove ${channel.title}?`,
        '',
        'Users will no longer have to join it. Cached membership rows for it are deleted.',
      ].join('\n'),
      new InlineKeyboard()
        .text('Yes, remove', `admin:ch:rmc:${channel.id}`)
        .row()
        .text('Cancel', 'admin:channels'),
    );
  });

  bot.callbackQuery(/^admin:ch:rmc:\d+$/, superOnly, async (ctx) => {
    if (!ctx.from) return;

    const id = matchId(ctx);
    const removed = id === null ? null : removeChannel(db, id);
    if (!removed) {
      await ctx.answerCallbackQuery({ text: 'Channel not found.', show_alert: true });
      return;
    }

    membership.invalidate();
    logAdminAction(db, ctx.from.id, 'channel_remove', removed.chatRef, {
      title: removed.title,
    });

    await ctx.answerCallbackQuery({ text: 'Channel removed.' });
    await renderChannelList(ctx, deps);
  });

  bot.on('message', async (ctx, next) => {
    if (!ctx.from) return next();

    const input = adminInputs.get(ctx.from.id);
    if (!input) return next();

    const role = getAdminRole(db, ctx.from.id, config.superAdminId);
    if (role !== 'super_admin') {
      adminInputs.clear(ctx.from.id);
      return next();
    }

    const text = ctx.message?.text?.trim();
    if (text?.startsWith('/')) {
      const command = text.split(/\s+/)[0];
      if (command === '/cancel') {
        adminInputs.clear(ctx.from.id);
        await ctx.reply('Cancelled.');
        return;
      }
      if (command === '/skip' && input.kind === 'channel_add_link') {
        await completeChannel(ctx, deps, { ...input.draft, joinUrl: null }, ctx.from.id);
        return;
      }
      return next();
    }

    if (!text) {
      await ctx.reply('Send a text value, or /cancel to stop.');
      return;
    }

    if (input.kind === 'channel_add') {
      const resolved = await resolveChannel(bot, ctx.me.id, text);
      if (!resolved.ok) {
        await ctx.reply(`${resolved.error}\n\nTry again or /cancel.`);
        return;
      }

      if (!resolved.draft.joinUrl) {
        adminInputs.set(ctx.from.id, { kind: 'channel_add_link', draft: resolved.draft });
        await ctx.reply(
          [
            `Found ${resolved.draft.title}.`,
            '',
            'This is a private channel. Send its invite link (https://t.me/+…), or /skip to save it without a join button.',
          ].join('\n'),
        );
        return;
      }

      await completeChannel(ctx, deps, resolved.draft, ctx.from.id);
      return;
    }

    const parsed = parseJoinUrl(text);
    if (!parsed.ok) {
      await ctx.reply(`${parsed.error}\nSend https://t.me/+… or /skip.`);
      return;
    }

    await completeChannel(ctx, deps, { ...input.draft, joinUrl: parsed.value }, ctx.from.id);
  });
}
