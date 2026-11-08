import { InlineKeyboard } from 'grammy';
import type { Bot } from 'grammy';
import type { BotDeps } from '../types.js';
import { COMPRESSION_URL } from '../compression.js';
import { formatDuration, translate } from '../i18n.js';
import type { Lang } from '../i18n.js';
import { WORKSPACE_TTL_MS } from '../../workspace/types.js';
import { editOrReply } from '../ui.js';
import { requireSuperAdmin } from '../middleware/access.js';

function backKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(translate(lang, 'admin.back'), 'admin:home')
    .row()
    .text(translate(lang, 'menu.back'), 'menu:home');
}

function adminHomeKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(translate(lang, 'admin.users'), 'admin:users')
    .text(translate(lang, 'admin.channelsGroup'), 'admin:channels')
    .row()
    .text(translate(lang, 'admin.promotions'), 'admin:promotions')
    .text(translate(lang, 'admin.statistics'), 'admin:statistics')
    .row()
    .text(translate(lang, 'admin.configuration'), 'admin:config')
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
    translate(lang, 'admin.groupHint'),
  ].join('\n');
}

function usersText(lang: Lang, deps: BotDeps): string {
  return [
    translate(lang, 'admin.users.title'),
    '',
    translate(lang, 'admin.users.body', {
      workspaces: deps.workspaces.activeCount(),
      languages: deps.languages.size(),
    }),
    '',
    translate(lang, 'admin.users.howTo'),
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

function promotionsText(lang: Lang, deps: BotDeps): string {
  return [
    translate(lang, 'admin.promotions.title'),
    '',
    translate(lang, 'admin.promotions.body'),
    '',
    translate(lang, 'admin.promotions.prostuti', { url: deps.config.prostutiAppUrl }),
    translate(lang, 'admin.promotions.compress', { url: COMPRESSION_URL }),
  ].join('\n');
}

function statisticsText(lang: Lang, deps: BotDeps): string {
  const memory = process.memoryUsage();
  return [
    translate(lang, 'admin.stats.title'),
    '',
    translate(lang, 'admin.stats.uptime', {
      duration: formatDuration(lang, Math.round(process.uptime() * 1000)),
    }),
    translate(lang, 'admin.stats.memory', {
      used: Math.round(memory.heapUsed / 1024 / 1024),
      rss: Math.round(memory.rss / 1024 / 1024),
    }),
    translate(lang, 'admin.stats.languages', { count: deps.languages.size() }),
    '',
    translate(lang, 'admin.activeJobs', { count: deps.jobRunner.activeCount() }),
    translate(lang, 'admin.queued', { count: deps.fileQueue.pending }),
    translate(lang, 'admin.workspaces', { count: deps.workspaces.activeCount() }),
    translate(lang, 'admin.merges', { count: deps.mergeSessions.activeCount() }),
    translate(lang, 'admin.tools', { count: deps.toolSessions.activeCount() }),
  ].join('\n');
}

function configurationText(lang: Lang, deps: BotDeps): string {
  const { config } = deps;
  return [
    translate(lang, 'admin.config.title'),
    '',
    translate(lang, 'admin.config.limits', {
      uploadMb: config.maxUploadMb,
      outputMb: config.maxOutputMb,
      pages: config.maxPdfPages,
      files: config.mergeMaxFiles,
      totalMb: config.mergeMaxTotalMb,
    }),
    translate(lang, 'admin.config.timeouts', {
      processSeconds: config.processTimeoutSeconds,
      transferSeconds: config.fileTransferTimeoutSeconds,
      workspaceMinutes: Math.round(WORKSPACE_TTL_MS / 60_000),
    }),
    translate(lang, 'admin.config.mode', {
      mode: config.botMode,
      concurrency: config.processConcurrency,
      rasterPages: config.rasterMaxPages,
    }),
    '',
    translate(lang, 'admin.channelsFromEnv'),
    translate(lang, 'admin.config.env'),
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

  bot.callbackQuery('admin:users', superOnly, async (ctx) => {
    const lang = langOf(ctx);
    await ctx.answerCallbackQuery();
    await editOrReply(ctx, usersText(lang, deps), backKeyboard(lang));
  });

  bot.callbackQuery('admin:channels', superOnly, async (ctx) => {
    const lang = langOf(ctx);
    await ctx.answerCallbackQuery();
    await editOrReply(ctx, channelsText(lang, deps), backKeyboard(lang));
  });

  bot.callbackQuery('admin:promotions', superOnly, async (ctx) => {
    const lang = langOf(ctx);
    await ctx.answerCallbackQuery();
    await editOrReply(
      ctx,
      promotionsText(lang, deps),
      new InlineKeyboard()
        .url(translate(lang, 'menu.prostuti'), deps.config.prostutiAppUrl)
        .row()
        .url(translate(lang, 'menu.compress'), COMPRESSION_URL)
        .row()
        .text(translate(lang, 'admin.back'), 'admin:home')
        .text(translate(lang, 'menu.back'), 'menu:home'),
    );
  });

  bot.callbackQuery('admin:statistics', superOnly, async (ctx) => {
    const lang = langOf(ctx);
    await ctx.answerCallbackQuery();
    await editOrReply(ctx, statisticsText(lang, deps), backKeyboard(lang));
  });

  bot.callbackQuery('admin:config', superOnly, async (ctx) => {
    const lang = langOf(ctx);
    await ctx.answerCallbackQuery();
    await editOrReply(ctx, configurationText(lang, deps), backKeyboard(lang));
  });
}
