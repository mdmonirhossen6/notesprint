import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';
import { getAccessRole, isSuperAdmin } from '../../auth/access.js';
import type { BotDeps } from '../types.js';
import {
  aboutText,
  editOrReply,
  helpKeyboard,
  helpText,
  joinRequiredKeyboard,
  joinRequiredText,
  mainMenuKeyboard,
  mainMenuText,
} from '../ui.js';

export async function showHome(ctx: Context, deps: BotDeps): Promise<void> {
  if (!ctx.from) return;

  const summary = await deps.membership.check(ctx.from.id);
  if (!summary.allJoined) {
    await editOrReply(ctx, joinRequiredText(summary), joinRequiredKeyboard(summary));
    return;
  }

  await editOrReply(
    ctx,
    mainMenuText(ctx.from.first_name),
    mainMenuKeyboard(deps.config, isSuperAdmin(ctx.from.id, deps.config.superAdminId)),
  );
}

function backKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Back to menu', 'menu:home');
}

function showHelp(ctx: Context, deps: BotDeps): Promise<void> {
  return editOrReply(
    ctx,
    helpText(
      deps.config.maxUploadMb,
      deps.config.maxOutputMb,
      deps.config.mergeMaxFiles,
      deps.config.rasterMaxPages,
    ),
    helpKeyboard(),
  );
}

export function registerUserHandlers(bot: Bot, deps: BotDeps): void {
  const { config, membership } = deps;

  bot.command('start', async (ctx) => {
    await showHome(ctx, deps);
  });

  bot.command('menu', async (ctx) => {
    await showHome(ctx, deps);
  });

  bot.command('help', async (ctx) => {
    await showHelp(ctx, deps);
  });

  bot.command('about', async (ctx) => {
    await editOrReply(ctx, aboutText(), backKeyboard());
  });

  bot.command('verify', async (ctx) => {
    if (!ctx.from) return;
    const summary = await membership.check(ctx.from.id, { force: true });
    if (!summary.allJoined) {
      await editOrReply(ctx, joinRequiredText(summary), joinRequiredKeyboard(summary));
      return;
    }
    await editOrReply(
      ctx,
      mainMenuText(ctx.from.first_name),
      mainMenuKeyboard(config, isSuperAdmin(ctx.from.id, config.superAdminId)),
    );
  });

  bot.command('whoami', async (ctx) => {
    if (!ctx.from) return;
    const role = getAccessRole(ctx.from.id, config.superAdminId);
    await ctx.reply([`Telegram ID: ${ctx.from.id}`, `Role: ${role ?? 'user'}`].join('\n'));
  });

  bot.callbackQuery('menu:home', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showHome(ctx, deps);
  });

  bot.callbackQuery('menu:help', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showHelp(ctx, deps);
  });

  bot.callbackQuery('menu:about', async (ctx) => {
    await ctx.answerCallbackQuery();
    await editOrReply(ctx, aboutText(), backKeyboard());
  });

  bot.callbackQuery('verify:check', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const summary = await membership.check(ctx.from.id, { force: true });
    if (!summary.allJoined) {
      await editOrReply(ctx, joinRequiredText(summary), joinRequiredKeyboard(summary));
      return;
    }

    await editOrReply(
      ctx,
      mainMenuText(ctx.from.first_name),
      mainMenuKeyboard(config, isSuperAdmin(ctx.from.id, config.superAdminId)),
    );
  });

  bot.callbackQuery(/^channel:nolink:\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery({
      text: 'This channel has no public join link yet. Please contact an administrator.',
      show_alert: true,
    });
  });
}
