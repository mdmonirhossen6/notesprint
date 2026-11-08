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
    .text(translate(lang, 'menu.newWorkspace'), 'menu:new')
    .row()
    .text(translate(lang, hasWorkspace ? 'menu.myWorkspace' : 'menu.noWorkspace'), 'menu:workspace')
    .row()
    .text(translate(lang, 'menu.tools'), 'menu:tools')
    .row()
    .url(translate(lang, 'menu.compress'), COMPRESSION_URL)
    .row()
    .text(translate(lang, 'menu.language'), 'menu:language')
    .row()
    .text(translate(lang, 'menu.help'), 'menu:help')
    .text(translate(lang, 'menu.about'), 'menu:about')
    .row()
    .url(translate(lang, 'menu.prostuti'), config.prostutiAppUrl);

  if (admin) {
    keyboard.row().text(translate(lang, 'menu.admin'), 'admin:home');
  }

  return keyboard;
}

export function colorToolsText(): string {
  return [
    '🎨 Color Tools',
    '',
    'Grayscale converts pages to readable gray tones.',
    'Black & White produces true monochrome output with a threshold preset.',
    'Invert Colors flips light and dark, including images.',
    'Clear Background turns off-white paper into clean white.',
    '',
    'These tools render pages sequentially and have a lower page limit.',
  ].join('\n');
}

export function colorToolsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('⚪ Grayscale', 'tool:gray')
    .text('⚫ Black & White', 'tool:bw')
    .row()
    .text('🌗 Invert Colors', 'tool:invert')
    .text('🧽 Clear Background', 'tool:clear')
    .row()
    .text('Back to menu', 'menu:home');
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
    translate(lang, 'help.title'),
    '',
    translate(lang, 'help.commands'),
    '',
    translate(lang, 'help.membership'),
    '',
    translate(lang, 'help.workspace'),
    translate(lang, 'help.tools'),
    '',
    translate(lang, 'help.limits', limits),
    translate(lang, 'help.privacy'),
    translate(lang, 'help.render'),
    '',
    translate(lang, 'help.language'),
    '',
    [
      translate(lang, 'compression.title'),
      translate(lang, 'compression.step1'),
      translate(lang, 'compression.step2'),
      translate(lang, 'compression.step3'),
      translate(lang, 'compression.step4'),
      translate(lang, 'compression.step5'),
      translate(lang, 'compression.step6'),
      '',
      translate(lang, 'compression.external'),
      translate(lang, 'compression.neverUpload'),
      translate(lang, 'compression.sensitive'),
    ].join('\n'),
  ].join('\n');
}

export function helpKeyboard(lang: Lang): InlineKeyboard {
  return new InlineKeyboard()
    .url(translate(lang, 'menu.compress'), COMPRESSION_URL)
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
