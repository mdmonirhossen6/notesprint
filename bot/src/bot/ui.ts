import type { Bot, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { MembershipSummary } from '../channels/membership.js';
import { BOT_VERSION } from '../version.js';
import {
  MAX_WORKSPACE_FILES,
  WORKSPACE_TTL_MS,
} from '../workspace/types.js';
import type { Workspace } from '../workspace/types.js';
import { COMPRESSION_URL } from './compression.js';
import { translate } from './i18n.js';
import type { Lang } from './i18n.js';

export function mainMenuText(lang: Lang, firstName?: string, workspace?: Workspace | null): string {
  const greeting = firstName
    ? translate(lang, 'menu.greeting', { name: firstName })
    : translate(lang, 'menu.welcome');
  const lines = [
    translate(lang, 'menu.title'),
    '',
    greeting,
    translate(lang, 'menu.subtitle'),
    '',
    translate(lang, 'menu.filesDeleted'),
  ];

  if (workspace) {
    lines.push(
      '',
      translate(lang, 'menu.workspaceStatus', {
        files: workspace.files.length,
        operations: workspace.operations.length,
      }),
    );
    const remaining = workspace.updatedAt + WORKSPACE_TTL_MS - Date.now();
    if (remaining > 0) {
      lines.push(
        translate(lang, 'menu.workspaceExpires', {
          minutes: Math.max(1, Math.ceil(remaining / 60_000)),
        }),
      );
    }
  }

  return lines.join('\n');
}

export function mainMenuKeyboard(
  lang: Lang,
  config: AppConfig,
  admin: boolean,
  hasWorkspace: boolean,
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text(
      translate(lang, hasWorkspace ? 'menu.myWorkspace' : 'menu.newWorkspace'),
      hasWorkspace ? 'menu:workspace' : 'menu:new',
    )
    .row()
    .text(translate(lang, 'menu.help'), 'menu:help')
    .row()
    .text(translate(lang, 'menu.language'), 'menu:language')
    .row()
    .url(translate(lang, 'menu.prostuti'), config.prostutiAppUrl);

  if (admin) {
    keyboard.row().text(translate(lang, 'menu.admin'), 'admin:home');
  }

  return keyboard;
}

export function tutorialText(lang: Lang): string {
  return [
    translate(lang, 'tutorial.title'),
    '',
    translate(lang, 'tutorial.body'),
    '',
    translate(lang, 'tutorial.advanced'),
  ].join('\n');
}

export function tutorialKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(translate(lang, 'tutorial.start'), 'tut:start')
    .row()
    .text(translate(lang, 'tutorial.skip'), 'tut:skip');
}

export function helpText(lang: Lang, config: AppConfig): string {
  const limits = {
    maxUploadMb: config.maxUploadMb,
    maxOutputMb: config.maxOutputMb,
    maxFiles: MAX_WORKSPACE_FILES,
    maxTotalMb: config.mergeMaxTotalMb,
    maxPages: config.maxPdfPages,
  };

  return [
    translate(lang, 'guide.title'),
    '',
    translate(lang, 'guide.intro'),
    '',
    translate(lang, 'guide.step1'),
    translate(lang, 'guide.step2'),
    translate(lang, 'guide.step3'),
    translate(lang, 'guide.step4'),
    translate(lang, 'guide.step5'),
    translate(lang, 'guide.step6'),
    translate(lang, 'guide.step7'),
    translate(lang, 'guide.step8'),
    translate(lang, 'guide.step9'),
    '',
    translate(lang, 'guide.limits', limits),
    translate(lang, 'guide.privacy'),
    translate(lang, 'guide.render'),
    translate(lang, 'compression.external'),
    '',
    translate(lang, 'help.commands'),
  ].join('\n');
}

export function helpKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .text(translate(lang, 'guide.start'), 'menu:new')
    .row()
    .url(translate(lang, 'guide.compress'), COMPRESSION_URL)
    .row()
    .text(translate(lang, 'menu.back'), 'menu:home');
}

export function aboutText(lang: Lang): string {
  return [
    translate(lang, 'about.title', { version: BOT_VERSION }),
    '',
    translate(lang, 'about.body'),
    '',
    translate(lang, 'about.stateless'),
    translate(lang, 'about.project'),
  ].join('\n');
}

export function joinRequiredText(lang: Lang, summary: MembershipSummary): string {
  const lines = [
    translate(lang, 'join.title'),
    '',
    translate(lang, 'join.instructions'),
    '',
  ];

  for (const entry of summary.channels) {
    const icon = entry.isMember ? '✅' : entry.unavailable ? '⚠️' : '❌';
    const note = entry.unavailable ? ` (${translate(lang, 'join.unavailable')})` : '';
    lines.push(`${icon} ${entry.channel.title}${note}`);
  }

  if (summary.hasUnavailable) {
    lines.push('', translate(lang, 'join.retryLater'));
  }

  return lines.join('\n');
}

export function joinRequiredKeyboard(lang: Lang, summary: MembershipSummary): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const entry of summary.channels) {
    if (entry.isMember) continue;
    const label = `Join ${entry.channel.title}`;
    if (entry.channel.joinUrl) {
      keyboard.url(label, entry.channel.joinUrl).row();
    } else {
      keyboard.text(label, `channel:nolink:${entry.channel.id}`).row();
    }
  }

  keyboard.text(translate(lang, 'join.verify'), 'verify:check').row();
  keyboard
    .text(translate(lang, 'join.help'), 'menu:help')
    .text(translate(lang, 'join.about'), 'menu:about');
  return keyboard;
}

export async function editOrReply(
  ctx: Context,
  text: string,
  keyboard: InlineKeyboard,
): Promise<void> {
  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
      return;
    } catch {
      // The message may be too old or unchanged; fall back to a new message.
    }
  }
  await ctx.reply(text, { reply_markup: keyboard });
}

export function attachErrorHandler(bot: Bot, logger: Logger): void {
  bot.catch((error) => {
    logger.error(
      'update_failed',
      { updateId: error.ctx.update.update_id, chatId: error.ctx.chat?.id },
      error.error,
    );
  });
}
