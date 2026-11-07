import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import type { BotDeps } from '../types.js';
import { editOrReply } from '../ui.js';
import { requireSuperAdmin } from '../middleware/access.js';

function adminHomeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Required channels', 'admin:channels')
    .row()
    .text('Back to menu', 'menu:home');
}

function adminHomeText(deps: BotDeps): string {
  return [
    '🛠 Admin panel',
    'Role: super_admin',
    '',
    `Active PDF jobs: ${deps.jobRunner.activeCount()}`,
    `Queued jobs: ${deps.fileQueue.pending}`,
    '',
    'This is a stateless deployment.',
    'Required channels come from REQUIRED_CHANNELS and settings do not persist across restarts.',
  ].join('\n');
}

function channelsText(deps: BotDeps): string {
  const channels = deps.config.requiredChannels;
  if (channels.length === 0) {
    return [
      'Required channels',
      '',
      'No channels configured. The bot is open to everyone.',
      '',
      'Set REQUIRED_CHANNELS on Render to require membership.',
    ].join('\n');
  }

  return [
    'Required channels',
    '',
    ...channels.flatMap((channel, index) => [
      `${index + 1}. ${channel.title}`,
      `   Ref: ${channel.chatRef}`,
      `   Join: ${channel.joinUrl ?? 'not set'}`,
    ]),
    '',
    'Change REQUIRED_CHANNELS on Render, then redeploy or restart.',
  ].join('\n');
}

export function registerAdminHandlers(bot: Bot, deps: BotDeps): void {
  const superOnly = requireSuperAdmin(deps.config);

  bot.command('admin', superOnly, async (ctx) => {
    await ctx.reply(adminHomeText(deps), { reply_markup: adminHomeKeyboard() });
  });

  bot.callbackQuery('admin:home', superOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    await editOrReply(ctx, adminHomeText(deps), adminHomeKeyboard());
  });

  bot.callbackQuery('admin:channels', superOnly, async (ctx) => {
    await ctx.answerCallbackQuery();
    await editOrReply(
      ctx,
      channelsText(deps),
      new InlineKeyboard().text('Back', 'admin:home'),
    );
  });
}
