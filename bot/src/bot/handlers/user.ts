import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';
import { getAccessRole, isSuperAdmin } from '../../auth/access.js';
import type { BotDeps } from '../types.js';
import { languageLabel, translate } from '../i18n.js';
import type { Lang } from '../i18n.js';
import {
  aboutText,
  editOrReply,
  helpKeyboard,
  helpText,
  joinRequiredKeyboard,
  joinRequiredText,
  mainMenuKeyboard,
  mainMenuText,
  tutorialKeyboard,
  tutorialText,
} from '../ui.js';
import { languagePanel, workspacePanel } from '../workspace-views.js';

function langOf(ctx: Context, deps: BotDeps): Lang {
  if (!ctx.from) return 'bn';
  return deps.languages.resolve(ctx.from.id, ctx.from.language_code);
}

export async function showHome(ctx: Context, deps: BotDeps): Promise<void> {
  if (!ctx.from) return;

  const lang = langOf(ctx, deps);
  const summary = await deps.membership.check(ctx.from.id);
  if (!summary.allJoined) {
    await editOrReply(ctx, joinRequiredText(lang, summary), joinRequiredKeyboard(lang, summary));
    return;
  }

  const workspace = deps.workspaces.get(ctx.from.id);
  await editOrReply(
    ctx,
    mainMenuText(lang, ctx.from.first_name, workspace),
    mainMenuKeyboard(
      lang,
      deps.config,
      isSuperAdmin(ctx.from.id, deps.config.superAdminId),
      workspace !== null,
    ),
  );
}

function backKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard().text(translate(lang, 'menu.back'), 'menu:home');
}

function showHelp(ctx: Context, deps: BotDeps): Promise<void> {
  const lang = langOf(ctx, deps);
  return editOrReply(ctx, helpText(lang, deps.config), helpKeyboard(lang));
}

function showLanguage(ctx: Context, deps: BotDeps): Promise<void> {
  const lang = langOf(ctx, deps);
  const { text, keyboard } = languagePanel(lang);
  return editOrReply(ctx, text, keyboard);
}

async function startTutorialWorkspace(ctx: Context, deps: BotDeps): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  const lang = langOf(ctx, deps);
  const summary = await deps.membership.check(ctx.from.id);
  if (!summary.allJoined) {
    await editOrReply(ctx, joinRequiredText(lang, summary), joinRequiredKeyboard(lang, summary));
    return;
  }

  let workspace = deps.workspaces.get(ctx.from.id);
  if (workspace && workspace.chatId !== ctx.chat.id) {
    await editOrReply(
      ctx,
      translate(lang, 'ws.upload.otherChat'),
      new InlineKeyboard().text(translate(lang, 'ws.btn.menu'), 'menu:home'),
    );
    return;
  }
  workspace ??= deps.workspaces.start(ctx.from.id, ctx.chat.id).workspace;
  if (workspace.status !== 'processing') {
    workspace.awaitingUpload = true;
    workspace.replacingFileId = null;
  }
  deps.workspaces.touch(ctx.from.id);
  const panel = workspacePanel(lang, workspace, deps.config);
  await editOrReply(ctx, panel.text, panel.keyboard);
}

export function registerUserHandlers(bot: Bot, deps: BotDeps): void {
  const { config, membership } = deps;

  bot.command('start', async (ctx) => {
    if (!ctx.from) return;
    if (!deps.tutorials.seen(ctx.from.id)) {
      const lang = langOf(ctx, deps);
      await editOrReply(ctx, tutorialText(lang), tutorialKeyboard(lang));
      return;
    }
    await showHome(ctx, deps);
  });

  bot.command('menu', async (ctx) => {
    await showHome(ctx, deps);
  });

  bot.command('help', async (ctx) => {
    await showHelp(ctx, deps);
  });

  bot.command('about', async (ctx) => {
    const lang = langOf(ctx, deps);
    await editOrReply(ctx, aboutText(lang), backKeyboard(lang));
  });

  bot.command('language', async (ctx) => {
    await showLanguage(ctx, deps);
  });

  bot.command('verify', async (ctx) => {
    if (!ctx.from) return;
    const lang = langOf(ctx, deps);
    const summary = await membership.check(ctx.from.id, { force: true });
    if (!summary.allJoined) {
      await editOrReply(ctx, joinRequiredText(lang, summary), joinRequiredKeyboard(lang, summary));
      return;
    }
    const workspace = deps.workspaces.get(ctx.from.id);
    await editOrReply(
      ctx,
      mainMenuText(lang, ctx.from.first_name, workspace),
      mainMenuKeyboard(
        lang,
        config,
        isSuperAdmin(ctx.from.id, config.superAdminId),
        workspace !== null,
      ),
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

  bot.callbackQuery('tut:start', async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    deps.tutorials.markSeen(ctx.from.id);
    await ctx.answerCallbackQuery();
    await startTutorialWorkspace(ctx, deps);
  });

  bot.callbackQuery('tut:skip', async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    deps.tutorials.markSeen(ctx.from.id);
    await ctx.answerCallbackQuery();
    await showHome(ctx, deps);
  });

  bot.callbackQuery('menu:about', async (ctx) => {
    const lang = langOf(ctx, deps);
    await ctx.answerCallbackQuery();
    await editOrReply(ctx, aboutText(lang), backKeyboard(lang));
  });

  bot.callbackQuery('menu:language', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showLanguage(ctx, deps);
  });

  bot.callbackQuery(/^lang:set:(bn|en)$/, async (ctx) => {
    if (!ctx.from) return;
    const value = ctx.match[1] as Lang;
    deps.languages.set(ctx.from.id, value);
    await ctx.answerCallbackQuery({
      text: translate(value, 'language.saved', { language: languageLabel(value) }),
    });
    await editOrReply(
      ctx,
      mainMenuText(value, ctx.from.first_name, deps.workspaces.get(ctx.from.id)),
      mainMenuKeyboard(
        value,
        config,
        isSuperAdmin(ctx.from.id, config.superAdminId),
        deps.workspaces.get(ctx.from.id) !== null,
      ),
    );
  });

  bot.callbackQuery('verify:check', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    const lang = langOf(ctx, deps);
    const summary = await membership.check(ctx.from.id, { force: true });
    if (!summary.allJoined) {
      await editOrReply(ctx, joinRequiredText(lang, summary), joinRequiredKeyboard(lang, summary));
      return;
    }

    const workspace = deps.workspaces.get(ctx.from.id);
    await editOrReply(
      ctx,
      mainMenuText(lang, ctx.from.first_name, workspace),
      mainMenuKeyboard(
        lang,
        config,
        isSuperAdmin(ctx.from.id, config.superAdminId),
        workspace !== null,
      ),
    );
  });

  bot.callbackQuery(/^channel:nolink:\d+$/, async (ctx) => {
    await ctx.answerCallbackQuery({
      text: translate(langOf(ctx, deps), 'join.noLink'),
      show_alert: true,
    });
  });
}
