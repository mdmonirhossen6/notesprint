import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';
import { checkDiskSpace } from '../../files/disk.js';
import { FileHandlingError, userMessageForFileError } from '../../files/errors.js';
import { intakePdf } from '../../files/intake.js';
import type { IntakeResult } from '../../files/intake.js';
import type { MergeSession } from '../../files/merge-session.js';
import { validatePdfMetadata } from '../../files/metadata.js';
import { cleanupFile, createTempPdfPath } from '../../files/paths.js';
import { sendDocumentFromPath } from '../../files/send.js';
import { formatBytes } from '../../lib/format.js';
import type { Logger } from '../../logger.js';
import { countPdfPages, mergePdfs } from '../../pdf/merge.js';
import type { BotDeps } from '../types.js';
import { oversizedPdfKeyboard, oversizedPdfText } from '../compression.js';
import { ensureMembership } from '../membership-view.js';
import { editOrReply } from '../ui.js';
import { showHome } from './user.js';

function mergeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Finish Uploading', 'merge:finish')
    .row()
    .text('Cancel', 'merge:cancel');
}

function postMergeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Merge more', 'tool:merge')
    .row()
    .text('Back to menu', 'menu:home');
}

function backKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Try again', 'tool:merge')
    .row()
    .text('Back to menu', 'menu:home');
}

function mergePromptText(deps: BotDeps, fileCount: number): string {
  const { config } = deps;
  return [
    '📎 Merge PDFs',
    '',
    `Send 2-${config.mergeMaxFiles} PDF documents, one at a time, in the order you want them merged.`,
    `Each file up to ${config.maxUploadMb} MB. Combined input up to ${config.mergeMaxTotalMb} MB.`,
    '',
    `Files ready: ${fileCount}/${config.mergeMaxFiles}`,
    fileCount < 2
      ? 'Send at least 2 PDFs, then tap Finish Uploading.'
      : 'Send another PDF or tap Finish Uploading.',
  ].join('\n');
}

export async function cleanupMergeSession(
  session: MergeSession,
  logger: Logger,
): Promise<void> {
  await Promise.all(
    session.files.map((file) =>
      cleanupFile(file.path).catch((error: unknown) => {
        logger.warn('temp_cleanup_failed', { userId: session.userId }, error);
      }),
    ),
  );
}

async function startMerge(ctx: Context, deps: BotDeps): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  if (!(await ensureMembership(ctx, deps))) return;

  if (deps.jobRunner.isActive(ctx.from.id)) {
    await editOrReply(
      ctx,
      ['⏳ You already have a PDF in progress.', '', 'Wait for it to finish or send /cancel.'].join(
        '\n',
      ),
      new InlineKeyboard().text('Cancel job', 'upload:cancel'),
    );
    return;
  }

  const existing = deps.mergeSessions.get(ctx.from.id);
  if (existing) {
    if (existing.chatId !== ctx.chat.id) {
      await editOrReply(
        ctx,
        [
          '📎 A merge is already active in another chat.',
          '',
          'Open that chat to add PDFs, or send /cancel there to discard it.',
        ].join('\n'),
        backKeyboard(),
      );
      return;
    }
    await editOrReply(ctx, mergePromptText(deps, existing.files.length), mergeKeyboard());
    return;
  }

  deps.uploadSessions.clear(ctx.from.id);
  deps.mergeSessions.start(ctx.from.id, ctx.chat.id);
  await editOrReply(ctx, mergePromptText(deps, 0), mergeKeyboard());
}

export function registerMergeHandlers(bot: Bot, deps: BotDeps): void {
  const { config, logger, mergeSessions, jobRunner } = deps;

  bot.callbackQuery('tool:merge', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startMerge(ctx, deps);
  });

  bot.callbackQuery('merge:cancel', async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }

    const session = mergeSessions.clear(ctx.from.id);
    if (session) {
      await cleanupMergeSession(session, logger);
      await ctx.answerCallbackQuery({ text: 'Merge cancelled' });
      await editOrReply(
        ctx,
        'Merge cancelled. Temporary files were removed.',
        new InlineKeyboard().text('Back to menu', 'menu:home'),
      );
      return;
    }

    if (jobRunner.cancel(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: 'Cancelling' });
      await editOrReply(
        ctx,
        'Cancelling the merge. Temporary files will be removed.',
        new InlineKeyboard().text('Back to menu', 'menu:home'),
      );
      return;
    }

    await ctx.answerCallbackQuery();
    await showHome(ctx, deps);
  });

  bot.callbackQuery('merge:finish', async (ctx) => {
    if (!ctx.from || !ctx.chat) {
      await ctx.answerCallbackQuery();
      return;
    }

    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const session = mergeSessions.get(userId);

    if (!session) {
      await ctx.answerCallbackQuery({
        text: 'This merge expired. Tap Merge PDFs to start again.',
        show_alert: true,
      });
      return;
    }
    if (session.chatId !== chatId) {
      await ctx.answerCallbackQuery({
        text: 'This merge was started in another chat.',
        show_alert: true,
      });
      return;
    }
    if (session.pending > 0) {
      await ctx.answerCallbackQuery({
        text: 'Still receiving the last PDF. Wait a moment, then tap Finish Uploading again.',
        show_alert: true,
      });
      return;
    }
    if (session.files.length < 2) {
      await ctx.answerCallbackQuery({
        text: 'Send at least 2 PDFs before merging.',
        show_alert: true,
      });
      return;
    }

    const maxTotalBytes = config.mergeMaxTotalMb * 1024 * 1024;
    const totalInputBytes = session.files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (totalInputBytes > maxTotalBytes) {
      await ctx.answerCallbackQuery({
        text: `Combined PDFs exceed the ${config.mergeMaxTotalMb} MB merge limit. Cancel and start over with fewer files.`,
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();

    if (!(await ensureMembership(ctx, deps))) return;

    const controller = jobRunner.tryStart(userId);
    if (!controller) {
      await editOrReply(
        ctx,
        'You already have a PDF in progress. Wait for it to finish or send /cancel.',
        backKeyboard(),
      );
      return;
    }

    const cleared = mergeSessions.clear(userId) ?? session;
    const files = cleared.files;
    const totalPages = files.reduce((sum, file) => sum + file.pages, 0);
    const outputPath = createTempPdfPath(config.tmpDir);
    const maxOutputBytes = config.maxOutputMb * 1024 * 1024;

    await editOrReply(
      ctx,
      [
        `⏳ Merging ${files.length} PDFs (${totalPages} pages)...`,
        '',
        'You will receive the result in this chat. Send /cancel to stop.',
      ].join('\n'),
      new InlineKeyboard().text('Cancel merge', 'upload:cancel'),
    );

    deps.fileQueue.enqueue(async () => {
      const startedAt = Date.now();
      let delivered = false;

      try {
        const result = await mergePdfs(
          files.map((file) => file.path),
          outputPath,
          {
            maxOutputBytes,
            maxPages: config.maxPdfPages,
            maxFiles: config.mergeMaxFiles,
            timeoutMs: config.processTimeoutSeconds * 1000,
            signal: controller.signal,
          },
        );

        if (controller.signal.aborted) {
          throw new FileHandlingError('cancelled', 'Merge was cancelled');
        }

        await sendDocumentFromPath({
          api: bot.api,
          chatId,
          filePath: outputPath,
          maxBytes: maxOutputBytes,
          fileName: 'notesprint-merged.pdf',
          caption: [
            '✅ Merged by NoteSprint.',
            `Files: ${result.files} · Pages: ${result.pages} · Size: ${formatBytes(result.outputBytes)}`,
            'This temporary copy has been deleted from the server.',
          ].join('\n'),
          replyMarkup: postMergeKeyboard(),
        });

        delivered = true;
        logger.info('pdf_merged', {
          userId,
          chatId,
          files: result.files,
          inputBytes: result.inputBytes,
          outputBytes: result.outputBytes,
          pages: result.pages,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        logger.warn('pdf_merge_failed', { userId, chatId }, error);
        if (controller.signal.aborted) {
          await bot.api
            .sendMessage(chatId, 'Cancelled. Temporary files were removed.')
            .catch(() => undefined);
        } else {
          await bot.api
            .sendMessage(chatId, `⚠️ ${userMessageForFileError(error, config.maxUploadMb)}`, {
              reply_markup: backKeyboard(),
            })
            .catch(() => undefined);
        }
      } finally {
        for (const file of files) {
          await cleanupFile(file.path).catch((error: unknown) => {
            logger.warn('temp_cleanup_failed', { userId }, error);
          });
        }
        await cleanupFile(outputPath).catch((error: unknown) => {
          logger.warn('temp_cleanup_failed', { userId }, error);
        });
        if (delivered) {
          logger.info('temp_files_removed', { userId, files: files.length + 1 });
        }
        jobRunner.finish(userId);
      }
    });
  });
}

export async function handleMergeDocument(
  ctx: Context,
  bot: Bot,
  deps: BotDeps,
): Promise<boolean> {
  if (!ctx.from || !ctx.chat || !ctx.message?.document) return false;

  const { config, logger, fileQueue, mergeSessions, uploadRateLimiter } = deps;
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  const maxTotalBytes = config.mergeMaxTotalMb * 1024 * 1024;
  const reserveBytes = config.minFreeDiskMb * 1024 * 1024;

  const session = mergeSessions.get(userId);
  if (!session) return false;

  if (session.chatId !== chatId) {
    await ctx.reply(
      'Your merge was started in another chat. Open that chat to continue, or send /cancel there.',
    );
    return true;
  }

  if (!(await ensureMembership(ctx, deps))) return true;

  const document = ctx.message.document;
  const validation = validatePdfMetadata(document, maxBytes);
  if (!validation.ok) {
    if (validation.code === 'too_large') {
      await ctx.reply(oversizedPdfText(config.maxUploadMb), {
        reply_markup: oversizedPdfKeyboard(),
      });
    } else {
      await ctx.reply(
        userMessageForFileError(
          new FileHandlingError(validation.code, 'Document failed validation'),
          config.maxUploadMb,
        ),
      );
    }
    return true;
  }

  const current = mergeSessions.get(userId);
  if (!current) {
    await ctx.reply('This merge expired. Tap "📎 Merge PDFs" to start again.');
    return true;
  }
  if (current.files.length + current.pending >= config.mergeMaxFiles) {
    await ctx.reply(
      `You can merge up to ${config.mergeMaxFiles} PDFs. Tap Finish Uploading or Cancel.`,
      { reply_markup: mergeKeyboard() },
    );
    return true;
  }

  const declaredSize = validation.declaredSize;
  const requiredBytes = declaredSize ?? maxBytes;
  try {
    const disk = await checkDiskSpace(config.tmpDir, requiredBytes, reserveBytes);
    if (!disk.ok) {
      await ctx.reply('The server is low on storage right now. Please try again later.');
      return true;
    }
  } catch (error) {
    logger.warn('disk_check_failed', { userId }, error);
    await ctx.reply('The server could not check available storage. Please try again later.');
    return true;
  }

  const limit = uploadRateLimiter.tryAcquire(userId);
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
    await ctx.reply(
      `⏳ Too many uploads. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      { reply_markup: mergeKeyboard() },
    );
    return true;
  }

  if (!mergeSessions.reserve(userId)) {
    await ctx.reply('This merge expired. Tap "📎 Merge PDFs" to start again.');
    return true;
  }

  const label = document.file_name?.trim() || 'PDF';
  const seq = ctx.message.message_id;
  const fileId = document.file_id;
  const signal = current.controller.signal;

  await ctx.reply(`📥 Receiving ${label}...`, { reply_markup: mergeKeyboard() });

  fileQueue.enqueue(async () => {
    let intake: IntakeResult | null = null;

    try {
      intake = await intakePdf({
        fileId,
        getFile: async (id) => {
          const file = await bot.api.getFile(id);
          return { file_path: file.file_path, file_size: file.file_size };
        },
        maxBytes,
        tmpDir: config.tmpDir,
        apiRoot: config.botApiRoot,
        botToken: config.botToken,
        timeoutMs: config.fileTransferTimeoutSeconds * 1000,
        declaredBytes: declaredSize,
        reserveBytes,
        localFileRoot: config.localFileRoot,
        signal,
      });

      const pages = await countPdfPages(intake.filePath);
      if (pages > config.maxPdfPages) {
        throw new FileHandlingError('too_many_pages', 'PDF exceeds the page limit for a merge');
      }

      const sizeBytes = intake.sizeBytes;
      const updated = mergeSessions.commit(userId, seq, {
        path: intake.filePath,
        name: label,
        sizeBytes,
        pages,
      });
      if (!updated) return;
      intake = null;

      const totalBytes = updated.files.reduce((sum, file) => sum + file.sizeBytes, 0);
      const totalPages = updated.files.reduce((sum, file) => sum + file.pages, 0);
      if (totalBytes > maxTotalBytes || totalPages > config.maxPdfPages) {
        const removed = mergeSessions.remove(userId, seq);
        if (removed) {
          await cleanupFile(removed.path).catch((error: unknown) => {
            logger.warn('temp_cleanup_failed', { userId }, error);
          });
        }
        await bot.api
          .sendMessage(
            chatId,
            [
              `⚠️ ${label} was not added.`,
              `A merge is limited to ${config.mergeMaxTotalMb} MB and ${config.maxPdfPages} pages.`,
              `Files ready: ${mergeSessions.get(userId)?.files.length ?? 0}/${config.mergeMaxFiles}.`,
            ].join('\n'),
            { reply_markup: mergeKeyboard() },
          )
          .catch(() => undefined);
        return;
      }

      await bot.api
        .sendMessage(
          chatId,
          [
            `✅ Added ${label} (${pages} page${pages === 1 ? '' : 's'}, ${formatBytes(sizeBytes)}).`,
            `Files ready: ${updated.files.length}/${config.mergeMaxFiles}.`,
            'Send another PDF or tap Finish Uploading.',
          ].join('\n'),
          { reply_markup: mergeKeyboard() },
        )
        .catch(() => undefined);
    } catch (error) {
      mergeSessions.fail(userId);
      if (signal.aborted) return;

      logger.warn('merge_intake_failed', { userId, chatId }, error);
      await bot.api
        .sendMessage(chatId, `⚠️ ${userMessageForFileError(error, config.maxUploadMb)}`, {
          reply_markup: mergeKeyboard(),
        })
        .catch(() => undefined);
    } finally {
      if (intake) {
        await cleanupFile(intake.filePath).catch((error: unknown) => {
          logger.warn('temp_cleanup_failed', { userId }, error);
        });
      }
    }
  });

  return true;
}
