import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';
import { checkDiskSpace } from '../../files/disk.js';
import { FileHandlingError, userMessageForFileError } from '../../files/errors.js';
import { intakePdf } from '../../files/intake.js';
import type { IntakeResult } from '../../files/intake.js';
import { validatePdfMetadata } from '../../files/metadata.js';
import { cleanupFile, createTempPdfPath } from '../../files/paths.js';
import { sendDocumentFromPath } from '../../files/send.js';
import { formatBytes } from '../../lib/format.js';
import { processPdf } from '../../pdf/process.js';
import type { BotDeps } from '../types.js';
import { oversizedPdfKeyboard, oversizedPdfText } from '../compression.js';
import { ensureMembership } from '../membership-view.js';
import { editOrReply } from '../ui.js';
import { cleanupMergeSession, handleMergeDocument } from './merge.js';
import { showHome } from './user.js';

function uploadPromptKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Cancel', 'upload:cancel');
}

function uploadPromptText(maxUploadMb: number): string {
  return [
    '🧩 Process PDF',
    '',
    `Send one PDF document up to ${maxUploadMb} MB.`,
    'Use the attachment (📎) menu and choose "File" — Telegram compresses photos.',
    '',
    'The PDF is processed one job at a time and deleted immediately after delivery.',
    'It is never archived.',
  ].join('\n');
}

function safeOutputName(fileName: string | undefined): string {
  const base = (fileName ?? 'document')
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 60);
  return `${base || 'document'}-notesprint.pdf`;
}

async function replyFileError(ctx: Context, error: unknown, deps: BotDeps): Promise<void> {
  if (error instanceof FileHandlingError && error.code === 'too_large') {
    await ctx.reply(oversizedPdfText(deps.config.maxUploadMb), {
      reply_markup: oversizedPdfKeyboard(),
    });
    return;
  }
  await ctx.reply(userMessageForFileError(error, deps.config.maxUploadMb));
}

export function registerUploadHandlers(bot: Bot, deps: BotDeps): void {
  const {
    config,
    logger,
    fileQueue,
    uploadSessions,
    mergeSessions,
    uploadRateLimiter,
    jobRunner,
  } = deps;
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  const maxOutputBytes = config.maxOutputMb * 1024 * 1024;
  const reserveBytes = config.minFreeDiskMb * 1024 * 1024;

  async function startUpload(ctx: Context): Promise<void> {
    if (!ctx.from) return;
    if (!(await ensureMembership(ctx, deps))) return;

    if (mergeSessions.get(ctx.from.id)) {
      await editOrReply(
        ctx,
        [
          '📎 You have a merge in progress.',
          '',
          'Tap Finish Uploading or Cancel in that merge before starting a single-file job.',
        ].join('\n'),
        new InlineKeyboard().text('Open merge', 'tool:merge').row().text('Cancel merge', 'merge:cancel'),
      );
      return;
    }

    if (jobRunner.isActive(ctx.from.id)) {
      await editOrReply(
        ctx,
        ['⏳ You already have a PDF in progress.', '', 'Wait for it to finish or send /cancel.'].join(
          '\n',
        ),
        new InlineKeyboard().text('Cancel job', 'upload:cancel'),
      );
      return;
    }

    uploadSessions.start(ctx.from.id);
    await editOrReply(ctx, uploadPromptText(config.maxUploadMb), uploadPromptKeyboard());
  }

  bot.callbackQuery('tool:process', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startUpload(ctx);
  });

  bot.callbackQuery('upload:retry', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startUpload(ctx);
  });

  bot.callbackQuery('upload:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!ctx.from) return;

    uploadSessions.clear(ctx.from.id);
    const merge = mergeSessions.clear(ctx.from.id);
    if (merge) {
      await cleanupMergeSession(merge, logger);
    }
    if (jobRunner.cancel(ctx.from.id)) {
      await ctx.reply('Cancelling the current PDF. Temporary files will be removed.');
      return;
    }
    if (merge) {
      await ctx.reply('Merge cancelled. Temporary files were removed.');
      return;
    }
    await showHome(ctx, deps);
  });

  bot.command('cancel', async (ctx) => {
    if (!ctx.from) return;

    uploadSessions.clear(ctx.from.id);
    const merge = mergeSessions.clear(ctx.from.id);
    if (merge) {
      await cleanupMergeSession(merge, logger);
    }

    if (jobRunner.cancel(ctx.from.id)) {
      await ctx.reply('Cancelling the current PDF. Temporary files will be removed.');
      return;
    }
    if (merge) {
      await ctx.reply('Merge cancelled. Temporary files were removed.');
      return;
    }
    await ctx.reply('Nothing to cancel.');
  });

  bot.on('message:document', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;

    const userId = ctx.from.id;
    const chatId = ctx.chat.id;

    if (await handleMergeDocument(ctx, bot, deps)) return;

    if (!uploadSessions.isActive(userId)) {
      await ctx.reply(
        'Tap "🧩 Process PDF" from the menu first, then send the PDF as a document.',
      );
      return;
    }

    if (!(await ensureMembership(ctx, deps))) return;

    const document = ctx.message.document;
    const validation = validatePdfMetadata(document, maxBytes);
    if (!validation.ok) {
      await replyFileError(
        ctx,
        new FileHandlingError(validation.code, 'Document failed validation'),
        deps,
      );
      return;
    }

    const requiredBytes = validation.declaredSize ?? maxBytes;
    try {
      const disk = await checkDiskSpace(
        config.tmpDir,
        requiredBytes,
        reserveBytes,
      );
      if (!disk.ok) {
        await ctx.reply('The server is low on storage right now. Please try again later.');
        return;
      }
    } catch (error) {
      logger.warn('disk_check_failed', { userId }, error);
      await ctx.reply('The server could not check available storage. Please try again later.');
      return;
    }

    const limit = uploadRateLimiter.tryAcquire(userId);
    if (!limit.allowed) {
      uploadSessions.clear(userId);
      const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
      await ctx.reply(
        `⏳ Too many uploads. Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
      return;
    }

    if (jobRunner.isActive(userId)) {
      await ctx.reply('You already have a PDF in progress. Wait for it or send /cancel.');
      return;
    }

    if (!uploadSessions.take(userId)) {
      await ctx.reply('This upload request expired. Tap "🧩 Process PDF" to start again.');
      return;
    }

    const controller = jobRunner.tryStart(userId);
    if (!controller) {
      await ctx.reply('You already have a PDF in progress. Wait for it or send /cancel.');
      return;
    }

    const declaredSize = validation.declaredSize;
    const fileId = document.file_id;
    const label = document.file_name?.trim() || 'your PDF';
    const outputName = safeOutputName(document.file_name);

    await ctx.reply(
      [
        declaredSize === null
          ? `📥 Received ${label}. Processing now.`
          : `📥 Received ${label} (${formatBytes(declaredSize)}). Processing now.`,
        '',
        'You will receive the result in this chat. Send /cancel to stop.',
      ].join('\n'),
    );

    fileQueue.enqueue(async () => {
      const startedAt = Date.now();
      let intake: IntakeResult | null = null;
      let outputPath: string | null = null;

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
          signal: controller.signal,
        });

        outputPath = createTempPdfPath(config.tmpDir);
        const processed = await processPdf(intake.filePath, outputPath, {
          maxOutputBytes,
          maxPages: config.maxPdfPages,
          timeoutMs: config.processTimeoutSeconds * 1000,
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          throw new FileHandlingError('cancelled', 'Job was cancelled');
        }

        await sendDocumentFromPath({
          api: bot.api,
          chatId,
          filePath: outputPath,
          maxBytes: maxOutputBytes,
          fileName: outputName,
          caption: [
            '✅ Processed by NoteSprint.',
            `Pages: ${processed.pages} · Size: ${formatBytes(processed.outputBytes)}`,
            'This temporary copy has been deleted from the server.',
          ].join('\n'),
        });

        logger.info('pdf_processed', {
          userId,
          chatId,
          inputBytes: processed.inputBytes,
          outputBytes: processed.outputBytes,
          pages: processed.pages,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        logger.warn('pdf_processing_failed', { userId, chatId }, error);

        if (controller.signal.aborted) {
          await bot.api
            .sendMessage(chatId, 'Cancelled. Temporary files were removed.')
            .catch(() => undefined);
        } else {
          await bot.api
            .sendMessage(chatId, `⚠️ ${userMessageForFileError(error, config.maxUploadMb)}`)
            .catch(() => undefined);
        }
      } finally {
        if (intake) {
          await cleanupFile(intake.filePath).catch((error: unknown) => {
            logger.warn('temp_cleanup_failed', { userId }, error);
          });
        }
        if (outputPath) {
          await cleanupFile(outputPath).catch((error: unknown) => {
            logger.warn('temp_cleanup_failed', { userId }, error);
          });
        }
        jobRunner.finish(userId);
      }
    });
  });
}
