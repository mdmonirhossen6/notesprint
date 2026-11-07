import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';
import { checkDiskSpace } from '../../files/disk.js';
import { FileHandlingError, userMessageForFileError } from '../../files/errors.js';
import { intakePdf } from '../../files/intake.js';
import type { IntakeResult } from '../../files/intake.js';
import { validatePdfMetadata } from '../../files/metadata.js';
import { cleanupFile, createTempPath, createTempPdfPath } from '../../files/paths.js';
import { sendDocumentFromPath } from '../../files/send.js';
import type { ToolSession } from '../../files/tool-session.js';
import { formatBytes } from '../../lib/format.js';
import type { Logger } from '../../logger.js';
import { countPdfPages } from '../../pdf/merge.js';
import { DEFAULT_NUP_SETTINGS } from '../../pdf/nup.js';
import type {
  MarginPreset,
  Orientation,
  PageNumberPosition,
  PaperSize,
} from '../../pdf/nup.js';
import { parseGroupSize, parsePageRanges } from '../../pdf/organize.js';
import { rasterPageLimit } from '../../pdf/raster.js';
import type { RasterFilter } from '../../pdf/raster.js';
import { TOOL_DEFINITIONS, isToolId } from '../../tools/definitions.js';
import type { ToolId } from '../../tools/definitions.js';
import { runTool } from '../../tools/run.js';
import { ensureMembership } from '../membership-view.js';
import {
  colorToolsKeyboard,
  colorToolsText,
  editOrReply,
} from '../ui.js';
import {
  inputPromptKeyboard,
  inputPromptText,
  toolErrorKeyboard,
  toolPanel,
  toolResultKeyboard,
  toolUploadKeyboard,
  toolUploadText,
} from '../tool-views.js';
import type { BotDeps } from '../types.js';
import { oversizedPdfKeyboard, oversizedPdfText } from '../compression.js';
import { showHome } from './user.js';

const ORIENTATIONS = ['portrait', 'landscape', 'auto'] as const;
const MARGINS = ['compact', 'normal', 'wide'] as const;
const GAPS = [0, 8, 16] as const;
const NUMBER_POSITIONS = ['bottom-center', 'bottom-right', 'top-center'] as const;
const NUMBER_SIZES = [8, 10, 12] as const;
const PAPERS = ['a4', 'a3', 'a5', 'letter', 'legal'] as const;
const PER_PAGE = [2, 4, 6, 9] as const;
const QUALITIES = ['low', 'medium', 'high'] as const;
const THRESHOLDS = ['light', 'balanced', 'strong'] as const;

function rasterFilterFor(tool: ToolId): RasterFilter | null {
  return tool === 'gray' || tool === 'bw' || tool === 'invert' || tool === 'clear'
    ? tool
    : null;
}

function homeKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Back to menu', 'menu:home');
}

function initialSettings(tool: ToolId): ToolSession['settings'] {
  switch (tool) {
    case 'reorder':
      return { awaiting: 'order' };
    case 'gray':
    case 'invert':
      return { quality: 'medium' };
    case 'bw':
      return { quality: 'medium', threshold: 'balanced' };
    case 'clear':
      return { quality: 'medium', clearLevel: 'medium' };
    case 'nup':
      return { nup: { ...DEFAULT_NUP_SETTINGS } };
    default:
      return {};
  }
}

export async function cleanupToolSession(session: ToolSession, logger: Logger): Promise<void> {
  if (!session.filePath) return;
  await cleanupFile(session.filePath).catch((error: unknown) => {
    logger.warn('temp_cleanup_failed', { userId: session.userId }, error);
  });
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

async function startTool(ctx: Context, deps: BotDeps, tool: ToolId): Promise<void> {
  if (!ctx.from || !ctx.chat) return;
  if (!(await ensureMembership(ctx, deps))) return;

  const userId = ctx.from.id;

  if (deps.jobRunner.isActive(userId)) {
    await editOrReply(
      ctx,
      ['⏳ You already have a PDF in progress.', '', 'Wait for it to finish or send /cancel.'].join(
        '\n',
      ),
      new InlineKeyboard().text('Cancel job', 'upload:cancel'),
    );
    return;
  }

  const existing = deps.toolSessions.get(userId);
  if (existing && existing.chatId !== ctx.chat.id) {
    await editOrReply(
      ctx,
      [
        '📎 A PDF tool is already active in another chat.',
        '',
        'Open that chat to finish or cancel it, or send /cancel there.',
      ].join('\n'),
      homeKeyboard(),
    );
    return;
  }

  if (deps.mergeSessions.get(userId)) {
    await editOrReply(
      ctx,
      [
        '📎 You have a merge in progress.',
        '',
        'Finish or cancel that merge before starting a single-file tool.',
      ].join('\n'),
      new InlineKeyboard()
        .text('Open merge', 'tool:merge')
        .row()
        .text('Cancel merge', 'merge:cancel'),
    );
    return;
  }

  deps.uploadSessions.clear(userId);
  const { previous } = deps.toolSessions.start(userId, ctx.chat.id, tool);
  if (previous) await cleanupToolSession(previous, deps.logger);

  const definition = TOOL_DEFINITIONS[tool];
  const filter = rasterFilterFor(tool);
  const uploadLimit = filter
    ? rasterPageLimit(filter, 'low', deps.config.rasterMaxPages)
    : deps.config.rasterMaxPages;
  await editOrReply(
    ctx,
    toolUploadText(definition, deps.config.maxUploadMb, uploadLimit),
    toolUploadKeyboard(),
  );
}

function showPrompt(ctx: Context, session: ToolSession): Promise<void> {
  return editOrReply(ctx, inputPromptText(session), inputPromptKeyboard(session));
}

function readinessError(
  session: ToolSession,
  config: { rasterMaxPages: number },
): string | null {
  const settings = session.settings;

  switch (session.tool) {
    case 'split':
      if (settings.mode === 'every') return null;
      if (settings.mode === 'extract') {
        return settings.indices?.length ? null : 'Send the pages to extract first.';
      }
      if (settings.mode === 'groups') {
        return settings.groupSize ? null : 'Choose a group size first.';
      }
      return 'Choose how to split the PDF first.';
    case 'select':
      if (!settings.mode) return 'Choose Keep selected or Remove selected first.';
      return settings.indices?.length ? null : 'Send the pages to keep or remove first.';
    case 'reorder':
      return settings.indices?.length === session.pages
        ? null
        : 'Send the complete page order first.';
    case 'rotate':
      if (settings.angle !== 90 && settings.angle !== 180 && settings.angle !== 270) {
        return 'Choose a rotation angle first.';
      }
      if (!settings.scope) return 'Choose All pages or Selected pages first.';
      if (settings.scope === 'selected' && !settings.indices?.length) {
        return 'Send the pages to rotate first.';
      }
      return null;
    case 'nup':
      return settings.nup ? null : 'N-up settings are unavailable. Cancel and start again.';
    case 'gray':
    case 'bw':
    case 'invert':
    case 'clear': {
      const quality = settings.quality ?? 'medium';
      const limit = rasterPageLimit(session.tool, quality, config.rasterMaxPages);
      if (session.pages <= limit) return null;
      const lower = quality === 'high' ? 'medium' : quality === 'medium' ? 'low' : null;
      const hint = lower
        ? ` Choose ${lower} quality for up to ${rasterPageLimit(session.tool, lower, config.rasterMaxPages)} pages.`
        : '';
      return `${TOOL_DEFINITIONS[session.tool].label} is limited to ${limit} pages at ${quality} quality.${hint}`;
    }
    default:
      return null;
  }
}

function outputTarget(deps: BotDeps, session: ToolSession): string {
  if (session.tool === 'split' && session.settings.mode !== 'extract') {
    const groupSize = session.settings.mode === 'every' ? 1 : (session.settings.groupSize ?? 1);
    const groups = Math.ceil(session.pages / groupSize);
    return createTempPath(deps.config.tmpDir, groups > 1 ? '.zip' : '.pdf');
  }
  return createTempPdfPath(deps.config.tmpDir);
}

export function registerToolHandlers(bot: Bot, deps: BotDeps): void {
  const { config, logger, fileQueue, uploadSessions, toolSessions, uploadRateLimiter, jobRunner } =
    deps;
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  const maxOutputBytes = config.maxOutputMb * 1024 * 1024;
  const reserveBytes = config.minFreeDiskMb * 1024 * 1024;

  bot.callbackQuery(/^tool:([a-z]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.callbackQuery.data?.slice('tool:'.length);
    if (!id) return;

    if (id === 'colors') {
      await editOrReply(ctx, colorToolsText(), colorToolsKeyboard());
      return;
    }

    if (!isToolId(id)) return;
    await startTool(ctx, deps, id);
  });

  bot.callbackQuery(/^ts:/, async (ctx) => {
    if (!ctx.from || !ctx.chat) {
      await ctx.answerCallbackQuery();
      return;
    }

    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const data = ctx.callbackQuery.data ?? '';
    const action = data.slice('ts:'.length);

    if (action === 'cancel') {
      await ctx.answerCallbackQuery();
      const session = toolSessions.clear(userId);
      if (session) await cleanupToolSession(session, logger);

      if (jobRunner.cancel(userId)) {
        await editOrReply(
          ctx,
          'Cancelling the current PDF. Temporary files will be removed.',
          homeKeyboard(),
        );
        return;
      }
      if (session) {
        await editOrReply(
          ctx,
          'Tool cancelled. Temporary files were removed.',
          homeKeyboard(),
        );
        return;
      }
      await showHome(ctx, deps);
      return;
    }

    if (action.startsWith('retry:')) {
      const id = action.slice('retry:'.length);
      if (!isToolId(id)) {
        await ctx.answerCallbackQuery();
        return;
      }
      await startTool(ctx, deps, id);
      return;
    }

    const session = toolSessions.get(userId);
    if (!session) {
      await ctx.answerCallbackQuery({
        text: 'This tool session expired. Start again from the menu.',
        show_alert: true,
      });
      return;
    }
    if (session.chatId !== chatId) {
      await ctx.answerCallbackQuery({
        text: 'This tool session belongs to another chat.',
        show_alert: true,
      });
      return;
    }

    if (action === 'go') {
      await runSession(ctx, bot, deps, session);
      return;
    }

    if (!applySetting(session, action)) {
      await ctx.answerCallbackQuery();
      return;
    }

    toolSessions.touch(userId);
    await ctx.answerCallbackQuery();

    if (session.settings.awaiting) {
      await showPrompt(ctx, session);
      return;
    }

    const panel = toolPanel(session, config);
    await editOrReply(ctx, panel.text, panel.keyboard);
  });

  bot.on('message:text', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;

    const session = toolSessions.get(ctx.from.id);
    if (!session || session.chatId !== ctx.chat.id) return;

    const awaiting = session.settings.awaiting;
    if (!awaiting) return;

    try {
      if (awaiting === 'ranges') {
        session.settings.indices = parsePageRanges(text, session.pages, 'subset');
        session.settings.rangesText = text;
      } else if (awaiting === 'order') {
        session.settings.indices = parsePageRanges(text, session.pages, 'permutation');
        session.settings.rangesText = text;
      } else if (awaiting === 'group-size') {
        session.settings.groupSize = parseGroupSize(text, session.pages);
      } else {
        const value = Number(text);
        if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
          throw new FileHandlingError(
            'invalid_range',
            'Send a whole number of 1 or higher for the first sheet number.',
          );
        }
        if (!session.settings.nup) {
          throw new FileHandlingError('process_failed', 'N-up settings are unavailable.');
        }
        session.settings.nup.numberStart = value;
      }

      if (toolSessions.get(ctx.from.id) !== session) return;

      session.settings.awaiting = null;
      toolSessions.touch(ctx.from.id);
      const panel = toolPanel(session, config);
      await ctx.reply(panel.text, { reply_markup: panel.keyboard });
    } catch (error) {
      await ctx.reply(
        [
          `⚠️ ${userMessageForFileError(error, config.maxUploadMb)}`,
          '',
          inputPromptText(session),
        ].join('\n'),
        { reply_markup: inputPromptKeyboard(session) },
      );
    }
  });

  bot.on('message:document', async (ctx) => {
    if (!ctx.from || !ctx.chat) return;

    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const session = toolSessions.get(userId);
    if (!session) return;

    if (session.chatId !== chatId) {
      await ctx.reply(
        'Your PDF tool was started in another chat. Open that chat to continue, or send /cancel there.',
      );
      return;
    }

    if (!(await ensureMembership(ctx, deps))) return;

    if (session.uploading) {
      await ctx.reply('Still receiving the previous PDF. Wait a moment, then continue.');
      return;
    }
    if (session.filePath) {
      await ctx.reply(
        'You already uploaded a PDF for this tool. Tap Process for that file, or Cancel to start over.',
      );
      return;
    }

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

    const declaredSize = validation.declaredSize;
    const requiredBytes = declaredSize ?? maxBytes;
    try {
      const disk = await checkDiskSpace(config.tmpDir, requiredBytes, reserveBytes);
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
      toolSessions.clear(userId);
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

    const controller = jobRunner.tryStart(userId);
    if (!controller) {
      await ctx.reply('You already have a PDF in progress. Wait for it or send /cancel.');
      return;
    }

    session.uploading = true;
    const signal = session.controller.signal;
    const fileId = document.file_id;
    const label = document.file_name?.trim() || 'your PDF';
    const tool = session.tool;
    const definition = TOOL_DEFINITIONS[tool];
    const rasterFilter = rasterFilterFor(tool);
    const rasterUploadLimit = rasterFilter
      ? rasterPageLimit(rasterFilter, 'low', config.rasterMaxPages)
      : config.rasterMaxPages;

    await ctx.reply(
      [
        declaredSize === null
          ? `📥 Receiving ${label}...`
          : `📥 Receiving ${label} (${formatBytes(declaredSize)})...`,
        '',
        `Preparing ${definition.label}.`,
      ].join('\n'),
    );

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

        if (toolSessions.get(userId) !== session) return;

        const pages = await countPdfPages(intake.filePath);
        if (toolSessions.get(userId) !== session) return;

        if (pages < 1) {
          throw new FileHandlingError('invalid_pdf', 'PDF has no pages');
        }
        if (pages > config.maxPdfPages) {
          throw new FileHandlingError(
            'too_many_pages',
            `This PDF has ${pages} pages; the current limit is ${config.maxPdfPages}.`,
          );
        }
        if (rasterFilter && pages > rasterUploadLimit) {
          throw new FileHandlingError(
            'raster_page_limit',
            `This PDF has ${pages} pages. ${definition.label} is limited to ${rasterUploadLimit} pages on this server.`,
          );
        }

        session.filePath = intake.filePath;
        session.fileName = label;
        session.sizeBytes = intake.sizeBytes;
        session.pages = pages;
        session.settings = initialSettings(tool);
        intake = null;

        toolSessions.touch(userId);
        const panel = toolPanel(session, config);
        await bot.api.sendMessage(chatId, panel.text, { reply_markup: panel.keyboard });
      } catch (error) {
        if (signal.aborted) return;

        logger.warn('tool_intake_failed', { userId, chatId, tool }, error);
        await bot.api
          .sendMessage(chatId, `⚠️ ${userMessageForFileError(error, config.maxUploadMb)}`, {
            reply_markup: new InlineKeyboard().text('Cancel', 'ts:cancel'),
          })
          .catch(() => undefined);
      } finally {
        session.uploading = false;
        if (intake) {
          await cleanupFile(intake.filePath).catch((error: unknown) => {
            logger.warn('temp_cleanup_failed', { userId }, error);
          });
        }
        jobRunner.finish(userId);
      }
    });
  });

  async function runSession(
    ctx: Context,
    botInstance: Bot,
    depsForRun: BotDeps,
    session: ToolSession,
  ): Promise<void> {
    const userId = session.userId;
    const chatId = session.chatId;

    if (!(await ensureMembership(ctx, depsForRun))) return;

    const notReady = readinessError(session, depsForRun.config);
    if (notReady) {
      await ctx.answerCallbackQuery({ text: notReady, show_alert: true });
      return;
    }

    if (jobRunner.isActive(userId)) {
      await ctx.answerCallbackQuery({
        text: 'You already have a PDF in progress. Wait for it or send /cancel.',
        show_alert: true,
      });
      return;
    }

    const controller = jobRunner.tryStart(userId);
    if (!controller) {
      await ctx.answerCallbackQuery({
        text: 'You already have a PDF in progress. Wait for it or send /cancel.',
        show_alert: true,
      });
      return;
    }

    if (!session.filePath) {
      jobRunner.finish(userId);
      await ctx.answerCallbackQuery({
        text: 'This tool session expired. Start again from the menu.',
        show_alert: true,
      });
      return;
    }

    const input = toolSessions.clear(userId) ?? session;
    const tool = input.tool;
    const definition = TOOL_DEFINITIONS[tool];
    const outputPath = outputTarget(depsForRun, input);

    await ctx.answerCallbackQuery();

    const progress = await botInstance.api
      .sendMessage(
        chatId,
        [
          `⏳ ${definition.label}: processing ${input.pages} page${input.pages === 1 ? '' : 's'}...`,
          '',
          'Send /cancel to stop.',
        ].join('\n'),
        { reply_markup: new InlineKeyboard().text('Cancel', 'upload:cancel') },
      )
      .catch(() => null);

    fileQueue.enqueue(async () => {
      const startedAt = Date.now();
      let progressDone = false;
      let lastProgressAt = 0;

      const updateProgress = async (text: string, keyboard: InlineKeyboard): Promise<void> => {
        if (!progress) return;
        try {
          await botInstance.api.editMessageText(chatId, progress.message_id, text, {
            reply_markup: keyboard,
          });
        } catch {
          await botInstance.api
            .sendMessage(chatId, text, { reply_markup: keyboard })
            .catch(() => undefined);
        }
      };

      try {
        const result = await runTool(input, {
          tmpDir: config.tmpDir,
          outputPath,
          maxOutputBytes,
          maxPages: config.maxPdfPages,
          rasterMaxPages: config.rasterMaxPages,
          rasterMaxPixelsPerPage: config.rasterMaxPixelsPerPage,
          timeoutMs: config.processTimeoutSeconds * 1000,
          signal: controller.signal,
          onRasterProgress: (done, total) => {
            if (progressDone || !progress) return;
            const now = Date.now();
            if (done !== total && now - lastProgressAt < 1200) return;
            lastProgressAt = now;
            void botInstance.api
              .editMessageText(
                chatId,
                progress.message_id,
                [
                  `⏳ ${definition.label}: ${done}/${total} pages...`,
                  '',
                  'Send /cancel to stop.',
                ].join('\n'),
                { reply_markup: new InlineKeyboard().text('Cancel', 'upload:cancel') },
              )
              .catch(() => undefined);
          },
        });

        if (controller.signal.aborted) {
          throw new FileHandlingError('cancelled', 'Tool was cancelled');
        }

        const caption = [
          `✅ ${definition.label} by NoteSprint.`,
          result.detail,
          `${result.zip ? `Files: ${result.fileCount} · ` : ''}Pages: ${result.pages} · Size: ${formatBytes(result.outputBytes)}`,
          'This temporary copy has been deleted from the server.',
        ].join('\n');

        await sendDocumentFromPath({
          api: botInstance.api,
          chatId,
          filePath: result.outputPath,
          maxBytes: maxOutputBytes,
          fileName: result.outputName,
          caption,
          replyMarkup: toolResultKeyboard(tool),
        });

        progressDone = true;
        await updateProgress(`✅ ${definition.label} finished.`, toolResultKeyboard(tool));

        logger.info('tool_processed', {
          userId,
          chatId,
          tool,
          inputBytes: input.sizeBytes,
          outputBytes: result.outputBytes,
          pages: input.pages,
          zipped: result.zip,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        progressDone = true;
        logger.warn('tool_failed', { userId, chatId, tool }, error);

        if (controller.signal.aborted) {
          await updateProgress(
            'Cancelled. Temporary files were removed.',
            new InlineKeyboard().text('Back to menu', 'menu:home'),
          );
        } else {
          await updateProgress(
            `⚠️ ${userMessageForFileError(error, config.maxUploadMb)}`,
            toolErrorKeyboard(tool),
          );
        }
      } finally {
        await cleanupFile(input.filePath).catch((error: unknown) => {
          logger.warn('temp_cleanup_failed', { userId }, error);
        });
        await cleanupFile(outputPath).catch((error: unknown) => {
          logger.warn('temp_cleanup_failed', { userId }, error);
        });
        jobRunner.finish(userId);
      }
    });
  }
}

function applySetting(session: ToolSession, action: string): boolean {
  const settings = session.settings;

  if (action === 'split:menu') {
    settings.mode = undefined;
    settings.indices = undefined;
    settings.groupSize = undefined;
    settings.awaiting = null;
    return true;
  }
  if (action === 'split:extract') {
    settings.mode = 'extract';
    settings.indices = undefined;
    settings.groupSize = undefined;
    settings.awaiting = 'ranges';
    return true;
  }
  if (action === 'split:every') {
    settings.mode = 'every';
    settings.indices = undefined;
    settings.groupSize = undefined;
    settings.awaiting = null;
    return true;
  }
  if (action === 'split:groups') {
    settings.mode = 'groups';
    settings.indices = undefined;
    settings.groupSize = undefined;
    settings.awaiting = 'group-size';
    return true;
  }
  if (action.startsWith('groupsize:')) {
    const size = Number(action.slice('groupsize:'.length));
    if (!Number.isSafeInteger(size) || size < 1 || size > session.pages) return false;
    settings.groupSize = size;
    settings.awaiting = null;
    return true;
  }

  if (action === 'sel:menu') {
    settings.mode = undefined;
    settings.indices = undefined;
    settings.awaiting = null;
    return true;
  }
  if (action === 'sel:keep' || action === 'sel:remove') {
    settings.mode = action === 'sel:keep' ? 'keep' : 'remove';
    settings.indices = undefined;
    settings.awaiting = 'ranges';
    return true;
  }

  if (action === 'reorder:prompt') {
    settings.indices = undefined;
    settings.awaiting = 'order';
    return true;
  }

  if (action === 'angle:menu') {
    settings.angle = undefined;
    settings.scope = undefined;
    settings.indices = undefined;
    settings.awaiting = null;
    return true;
  }
  if (action === 'angle:90' || action === 'angle:180' || action === 'angle:270') {
    settings.angle = Number(action.slice('angle:'.length)) as 90 | 180 | 270;
    settings.awaiting = null;
    return true;
  }
  if (action === 'scope:all') {
    settings.scope = 'all';
    settings.indices = undefined;
    settings.awaiting = null;
    return true;
  }
  if (action === 'scope:selected') {
    settings.scope = 'selected';
    settings.awaiting = 'ranges';
    return true;
  }

  if (action.startsWith('q:')) {
    const quality = action.slice(2);
    if (!isChoice(quality, QUALITIES)) return false;
    settings.quality = quality;
    return true;
  }
  if (action.startsWith('thr:')) {
    const threshold = action.slice(4);
    if (!isChoice(threshold, THRESHOLDS)) return false;
    settings.threshold = threshold;
    return true;
  }
  if (action.startsWith('clear:')) {
    const level = action.slice('clear:'.length);
    if (!isChoice(level, QUALITIES)) return false;
    settings.clearLevel = level;
    return true;
  }

  if (action === 'numstart:prompt') {
    settings.awaiting = 'number-start';
    return true;
  }

  const nup = settings.nup ?? { ...DEFAULT_NUP_SETTINGS };
  settings.nup = nup;

  if (action.startsWith('nup:')) {
    const value = Number(action.slice('nup:'.length));
    if (!isNumberChoice(value, PER_PAGE)) return false;
    nup.perPage = value;
    return true;
  }
  if (action.startsWith('paper:')) {
    const paper = action.slice('paper:'.length);
    if (!isChoice(paper, PAPERS)) return false;
    nup.paper = paper as PaperSize;
    return true;
  }
  if (action.startsWith('orient:')) {
    const orientation = action.slice('orient:'.length);
    if (!isChoice(orientation, ORIENTATIONS)) return false;
    nup.orientation = orientation as Orientation;
    return true;
  }
  if (action.startsWith('margin:')) {
    const margin = action.slice('margin:'.length);
    if (!isChoice(margin, MARGINS)) return false;
    nup.margin = margin as MarginPreset;
    return true;
  }
  if (action.startsWith('gap:')) {
    const gap = Number(action.slice('gap:'.length));
    if (!isNumberChoice(gap, GAPS)) return false;
    nup.gap = gap;
    return true;
  }
  if (action === 'sep:on' || action === 'sep:off') {
    nup.separators = action === 'sep:on';
    return true;
  }
  if (action === 'num:on' || action === 'num:off') {
    nup.pageNumbers = action === 'num:on';
    return true;
  }
  if (action.startsWith('numpos:')) {
    const position = action.slice('numpos:'.length);
    if (!isChoice(position, NUMBER_POSITIONS)) return false;
    nup.numberPosition = position as PageNumberPosition;
    return true;
  }
  if (action.startsWith('numsize:')) {
    const size = Number(action.slice('numsize:'.length));
    if (!isNumberChoice(size, NUMBER_SIZES)) return false;
    nup.numberSize = size;
    return true;
  }

  return false;
}

function isChoice<T extends string>(value: string, choices: readonly T[]): value is T {
  return (choices as readonly string[]).includes(value);
}

function isNumberChoice<T extends number>(value: number, choices: readonly T[]): value is T {
  return (choices as readonly number[]).includes(value);
}
