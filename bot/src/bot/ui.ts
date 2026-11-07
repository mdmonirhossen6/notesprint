import type { Bot, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { MembershipSummary } from '../channels/membership.js';
import { BOT_VERSION } from '../version.js';
import { COMPRESSION_URL, compressionHelpSection } from './compression.js';

export const TOOL_KEYS = ['process', 'merge', 'nup', 'enhance'] as const;
export type ToolKey = (typeof TOOL_KEYS)[number];

export const TOOL_LABELS: Record<ToolKey, { icon: string; title: string }> = {
  process: { icon: '🧩', title: 'Process PDF' },
  merge: { icon: '📎', title: 'Merge PDFs' },
  nup: { icon: '🧾', title: 'N-up Layout' },
  enhance: { icon: '✨', title: 'Enhance PDF' },
};

export function mainMenuText(firstName?: string): string {
  const greeting = firstName ? `Hi ${firstName}.` : 'Welcome.';
  return [
    '✨ NoteSprint',
    '',
    `${greeting} Pick a tool below — everything stays inside Telegram.`,
    '',
    'PDFs up to 19 MB are processed one at a time and deleted immediately after delivery.',
  ].join('\n');
}

export function mainMenuKeyboard(config: AppConfig, admin: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text('🧩 Process PDF', 'tool:process')
    .text('📎 Merge PDFs', 'tool:merge')
    .row()
    .text('🧾 N-up Layout', 'tool:nup')
    .text('✨ Enhance PDF', 'tool:enhance')
    .row()
    .url('Compress PDF', COMPRESSION_URL)
    .row()
    .text('❓ Help', 'menu:help')
    .text('ℹ️ About NoteSprint', 'menu:about')
    .row()
    .url('🚀 Explore Prostuti App', config.prostutiAppUrl);

  if (admin) {
    keyboard.row().text('🛠 Admin panel', 'admin:home');
  }

  return keyboard;
}

export function helpText(maxUploadMb: number, maxOutputMb: number): string {
  return [
    'NoteSprint help',
    '',
    '/start - open the main menu',
    '/verify - check channel membership again',
    '/cancel - cancel an upload or running PDF',
    '/whoami - show your Telegram ID and role',
    '/help - show this message',
    '',
    'Join every required channel, then tap Verify Membership.',
    'The bot checks membership again before opening any PDF tool.',
    '',
    `Upload limit: ${maxUploadMb} MB. Output limit: ${maxOutputMb} MB.`,
    'Files are temporary. They are deleted after delivery and never archived.',
    '',
    ...compressionHelpSection(),
  ].join('\n');
}

export function helpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .url('Compress PDF', COMPRESSION_URL)
    .row()
    .text('Back to menu', 'menu:home');
}

export function aboutText(): string {
  return [
    `✨ NoteSprint bot v${BOT_VERSION}`,
    '',
    'Turns scanned or handwritten PDF pages into clean, printable PDFs without leaving Telegram.',
    '',
    'Stateless deployment: no database, no permanent file storage.',
    'Project: https://github.com/mdmonirhossen6/notesprint',
  ].join('\n');
}

export function toolPlaceholderText(key: ToolKey): string {
  const tool = TOOL_LABELS[key];
  return [
    `${tool.icon} ${tool.title}`,
    '',
    'This tool is not active yet.',
    '',
    'No file has been processed.',
  ].join('\n');
}

export function joinRequiredText(summary: MembershipSummary): string {
  const lines = [
    '🔒 Channel membership required',
    '',
    'Join every channel below, then tap Verify Membership.',
    '',
  ];

  for (const entry of summary.channels) {
    const icon = entry.isMember ? '✅' : entry.unavailable ? '⚠️' : '❌';
    const note = entry.unavailable ? ' (temporarily unavailable)' : '';
    lines.push(`${icon} ${entry.channel.title}${note}`);
  }

  if (summary.hasUnavailable) {
    lines.push('', 'If a channel is unavailable, try again later or contact an administrator.');
  }

  return lines.join('\n');
}

export function joinRequiredKeyboard(summary: MembershipSummary): InlineKeyboard {
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

  keyboard.text('✅ Verify Membership', 'verify:check').row();
  keyboard.text('❓ Help', 'menu:help').text('ℹ️ About', 'menu:about');
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
