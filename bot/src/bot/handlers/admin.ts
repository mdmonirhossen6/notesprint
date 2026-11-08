import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import type { BotDeps } from '../types.js';
import { translate } from '../i18n.js';
import type { Lang } from '../i18n.js';
import { editOrReply } from '../ui.js';
import { requireSuperAdmin } from '../middleware/access.js';

function adminHomeKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(translate(lang, 'admin.channels'), 'admin:channels')
    .row()
    .text(translate(lang, 'menu.back'), 'menu:home');
}

function adminHomeText(lang: Lang, deps: BotDeps): string {
  return [
    translate(lang, 'admin.title'),
    translate(lang, 'admin.role'),
    '',
    translate(lang, 'admin.activeJobs', { count: deps.jobRunner.activeCount() }),
    translate(lang, 'admin.queued', { count: deps.fileQueue.pending }),
    translate(lang, 'admin.workspaces', { count: deps.workspaces.activeCount() }),
    translate(lang, 'admin.merges', { count: deps.mergeSessions.activeCount() }),
    translate(lang, 'admin.tools', { count: deps.toolSessions.activeCount() }),
    '',
    translate(lang, 'admin.stateless'),
    translate(lang, 'admin.channelsFromEnv'),
  ].join('\n');
}

function channelsText(lang: Lang, deps: BotDeps): string {
  const channels = deps.config.requiredChannels;
  if (channels.length === 0) {
    return [
      translate(lang, 'admin.channels'),
      '',
      translate(lang, 'admin.noChannels'),
      '',
      translate(lang, 'admin.setChannels'),
    ].join('\n');
  }

  return [
    translate(lang, 'admin.channels'),
    '',
    ...channels.flatMap((channel, index) => [
      `${index + 1}. ${channel.title}`,
      `   Ref: ${channel.chatRef}`,
      `   Join: ${channel.joinUrl ?? 'not set'}`,
    ]),
    '',
    translate(lang, 'admin.changeChannels'),
  ].join('\n');
}

export function registerAdminHandlers(bot: Bot, deps: BotDeps): void {
  const superOnly = requireSuperAdmin(deps.config);
  const langOf = (ctx: { from?: { id: number; language_code?: string } }): Lang =>
    ctx.from ? deps.languages.resolve(ctx.from.id, ctx.from.language_code) : 'bn';

  bot.command('admin', superOnly, async (ctx) => {
    const lang = langOf(ctx);
    await ctx.reply(adminHomeText(lang, deps), { reply_markup: adminHomeKeyboard(lang) });
  });

  bot.callbackQuery('admin:home', superOnly, async (ctx) => {
    const lang = langOf(ctx);
    await ctx.answerCallbackQuery();
    await editOrReply(ctx, adminHomeText(lang, deps), adminHomeKeyboard(lang));
  });

  bot.callbackQuery('admin:channels', superOnly, async (ctx) => {
    const lang = langOf(ctx);
    await ctx.answerCallbackQuery();
    await editOrReply(
      ctx,
      channelsText(lang, deps),
      new InlineKeyboard().text(translate(lang, 'admin.back'), 'admin:home'),
    );
  });
}
