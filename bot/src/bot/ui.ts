import type { Bot, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';
import type { MembershipSummary } from '../channels/membership.js';
import { BOT_VERSION } from '../version.js';
import { COMPRESSION_URL, compressionHelpSection } from './compression.js';

export function mainMenuText(firstName?: string): string {
  const greeting = firstName ? `Hi ${firstName}.` : 'Welcome.';
  return [
    '✨ NoteSprint',
    '',
    `${greeting} Pick a tool below — everything stays inside Telegram.`,
    '',
    'Process, merge, split, select, reorder, rotate, color, and N-up PDFs.',
    'Files are deleted immediately after delivery.',
  ].join('\n');
}

export function mainMenuKeyboard(config: AppConfig, admin: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text('🧩 Process PDF', 'tool:process')
    .text('📎 Merge PDFs', 'tool:merge')
    .row()
    .text('✂️ Split PDF', 'tool:split')
    .text('📑 Page Selection', 'tool:select')
    .row()
    .text('🔀 Page Reorder', 'tool:reorder')
    .text('🔄 Rotate PDF', 'tool:rotate')
    .row()
    .text('🎨 Color Tools', 'tool:colors')
    .text('🧾 N-up Layout', 'tool:nup')
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

export function helpText(
  maxUploadMb: number,
  maxOutputMb: number,
  mergeMaxFiles = 10,
  rasterMaxPages = 30,
): string {
  return [
    'NoteSprint help',
    '',
    '/start - open the main menu',
    '/verify - check channel membership again',
    '/cancel - cancel any upload or running PDF job',
    '/whoami - show your Telegram ID and role',
    '/help - show this message',
    '',
    'Join every required channel, then tap Verify Membership.',
    'The bot checks membership again before opening any PDF tool.',
    '',
    'Tools: Process, Merge, Split, Page Selection, Page Reorder, Rotate,',
    'Color Tools (Grayscale, Black & White, Invert, Clear Background), and N-up.',
    '',
    `Upload limit: ${maxUploadMb} MB. Output limit: ${maxOutputMb} MB.`,
    `Merge: send 2-${mergeMaxFiles} PDFs in order, then tap Finish Uploading.`,
    `Color tools: ${rasterMaxPages} pages max, with lower caps at higher quality.`,
    'Black & White has the strictest page cap. No OCR or handwriting clean-up is offered.',
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
    'Splits, merges, rotates, rearranges, and cleans up PDF pages inside Telegram.',
    '',
    'No OCR or handwriting recognition. Stateless deployment: no database, no permanent storage.',
    'Project: https://github.com/mdmonirhossen6/notesprint',
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
