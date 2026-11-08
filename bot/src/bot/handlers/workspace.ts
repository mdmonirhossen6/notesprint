import { InlineKeyboard } from 'grammy';
import type { Bot, Context } from 'grammy';
import { checkDiskSpace } from '../../files/disk.js';
import { FileHandlingError } from '../../files/errors.js';
import { intakePdf } from '../../files/intake.js';
import type { IntakeResult } from '../../files/intake.js';
import { validatePdfMetadata } from '../../files/metadata.js';
import { cleanupFile } from '../../files/paths.js';
import { sendDocumentFromPath } from '../../files/send.js';
import { formatBytes } from '../../lib/format.js';
import { countPdfPages } from '../../pdf/merge.js';
import { parseGroupSize, parsePageRanges } from '../../pdf/organize.js';
import { isPdfTextDrawable } from '../../pdf/personalize.js';
import {
  OPERATION_LABEL_KEYS,
  addOperation,
  clearOperations,
  findOperation,
  maxPagesBeforeOperation,
  moveOperation,
  operationLabelKey,
  removeOperation,
} from '../../workspace/operations.js';
import type { OperationCategory } from '../../workspace/operations.js';
import { applyPreset, applyPresetCustomization, isPresetId } from '../../workspace/presets.js';
import { cleanupWorkspaceRun, runWorkspacePipeline } from '../../workspace/run.js';
import type { PipelineRunResult, StageEvent } from '../../workspace/run.js';
import {
  MAX_WORKSPACE_FILES,
} from '../../workspace/types.js';
import type {
  AwaitingField,
  FooterPosition,
  OperationType,
  WatermarkPosition,
  Workspace,
  WorkspaceFile,
  WorkspaceOperation,
} from '../../workspace/types.js';
import { COMPRESSION_URL } from '../compression.js';
import { fileErrorMessage, translate } from '../i18n.js';
import type { Lang, TranslationKey } from '../i18n.js';
import { ensureMembership } from '../membership-view.js';
import type { BotDeps } from '../types.js';
import { editOrReply } from '../ui.js';
import {
  advancedToolsPanel,
  cancelConfirmPanel,
  completionText,
  customSettingsPanel,
  failureText,
  fileActionsPanel,
  modePanel,
  moreOptionsPanel,
  operationConfigPanel,
  operationsCatalogPanel,
  presetLabel,
  presetSummaryPanel,
  presetsPanel,
  processingKeyboard,
  progressText,
  rasterProgressText,
  remainingConfig,
  replacePromptPanel,
  resultKeyboard,
  retryKeyboard,
  workspaceFilesPanel,
  workspaceOperationsPanel,
  workspacePanel,
} from '../workspace-views.js';
import type { Panel } from '../workspace-views.js';

function t(lang: Lang, key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(lang, key, params);
}

function langOf(ctx: Context, deps: { languages: { resolve(userId: number, code?: string | null): Lang } }): Lang {
  if (!ctx.from) return 'bn';
  return deps.languages.resolve(ctx.from.id, ctx.from.language_code);
}

function isOperationType(value: string): value is OperationType {
  return value in OPERATION_LABEL_KEYS;
}

class WorkspaceInputError extends Error {
  constructor(
    readonly key: TranslationKey,
    readonly params?: Record<string, string | number>,
  ) {
    super(key);
    this.name = 'WorkspaceInputError';
  }
}

export function registerWorkspaceHandlers(bot: Bot, deps: BotDeps): void {
  const { config, logger, fileQueue, workspaces, uploadRateLimiter, jobRunner } = deps;
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  const maxOutputBytes = config.maxOutputMb * 1024 * 1024;
  const maxTotalBytes = config.mergeMaxTotalMb * 1024 * 1024;
  const reserveBytes = config.minFreeDiskMb * 1024 * 1024;

  async function showPanel(ctx: Context, panel: Panel): Promise<void> {
    await editOrReply(ctx, panel.text, panel.keyboard);
  }

  async function openWorkspace(ctx: Context, create: boolean): Promise<void> {
    if (!ctx.from || !ctx.chat) return;
    if (!(await ensureMembership(ctx, deps))) return;

    const lang = langOf(ctx, deps);
    let workspace = workspaces.get(ctx.from.id);

    if (workspace && workspace.chatId !== ctx.chat.id) {
      await editOrReply(
        ctx,
        t(lang, 'ws.upload.otherChat'),
        new InlineKeyboard().text(t(lang, 'ws.btn.menu'), 'menu:home'),
      );
      return;
    }

    if (!workspace) {
      workspace = workspaces.start(ctx.from.id, ctx.chat.id).workspace;
    } else if (create && workspace.status !== 'processing') {
      workspace.awaitingUpload = true;
      workspace.replacingFileId = null;
    }

    workspaces.touch(ctx.from.id);
    await showPanel(ctx, workspacePanel(lang, workspace, config));
  }

  async function requireWorkspace(
    ctx: Context,
  ): Promise<{ workspace: Workspace; lang: Lang } | null> {
    if (!ctx.from || !ctx.chat) {
      await ctx.answerCallbackQuery();
      return null;
    }
    const lang = langOf(ctx, deps);
    const workspace = workspaces.get(ctx.from.id);
    if (!workspace) {
      await ctx.answerCallbackQuery({
        text: t(lang, 'ws.expired'),
        show_alert: true,
      });
      return null;
    }
    if (workspace.chatId !== ctx.chat.id) {
      await ctx.answerCallbackQuery({
        text: t(lang, 'ws.upload.otherChat'),
        show_alert: true,
      });
      return null;
    }
    workspaces.touch(ctx.from.id);
    return { workspace, lang };
  }

  async function showWorkspace(ctx: Context, workspace: Workspace, lang: Lang): Promise<void> {
    await showPanel(ctx, workspacePanel(lang, workspace, config));
  }

  function configFor(): ReturnType<typeof remainingConfig> {
    return remainingConfig(config);
  }

  function promptPages(workspace: Workspace, operation: WorkspaceOperation): number {
    const index = workspace.operations.indexOf(operation);
    const pages = index >= 0 ? maxPagesBeforeOperation(workspace, index, configFor()) : 0;
    if (pages > 0) return pages;
    return workspace.files.reduce((sum, file) => sum + file.pages, 0) || 1;
  }

  function setPrompt(workspace: Workspace, operation: WorkspaceOperation, field: AwaitingField): void {
    workspace.awaitingText = { operationId: operation.id, field };
  }

  function applySetting(
    workspace: Workspace,
    operation: WorkspaceOperation,
    action: string,
  ): boolean {
    workspace.awaitingText = null;

    switch (operation.type) {
      case 'split':
        if (action === 'sp:every') {
          operation.mode = 'every';
          operation.indices = undefined;
          operation.groupSize = undefined;
          return true;
        }
        if (action === 'sp:groups') {
          operation.mode = 'groups';
          operation.indices = undefined;
          operation.groupSize = undefined;
          setPrompt(workspace, operation, 'group-size');
          return true;
        }
        if (action === 'sp:extract' || action === 'sp:pages') {
          operation.mode = 'extract';
          setPrompt(workspace, operation, 'ranges');
          return true;
        }
        return false;

      case 'select':
        if (action === 'sel:keep' || action === 'sel:remove') {
          operation.mode = action === 'sel:keep' ? 'keep' : 'remove';
          operation.indices = undefined;
          setPrompt(workspace, operation, 'ranges');
          return true;
        }
        if (action === 'sel:pages') {
          operation.mode ??= 'keep';
          setPrompt(workspace, operation, 'ranges');
          return true;
        }
        return false;

      case 'reorder':
        if (action === 'ro:order') {
          operation.indices = undefined;
          setPrompt(workspace, operation, 'order');
          return true;
        }
        return false;

      case 'rotate':
        if (action === 'an:90' || action === 'an:180' || action === 'an:270') {
          operation.angle = Number(action.slice(3)) as 90 | 180 | 270;
          return true;
        }
        if (action === 'sc:all') {
          operation.scope = 'all';
          operation.indices = undefined;
          return true;
        }
        if (action === 'sc:sel' || action === 'sc:pages') {
          operation.scope = 'selected';
          setPrompt(workspace, operation, 'ranges');
          return true;
        }
        return false;

      case 'gray':
      case 'invert':
        if (action.startsWith('q:')) {
          const quality = action.slice(2);
          if (quality !== 'low' && quality !== 'medium' && quality !== 'high') return false;
          operation.quality = quality;
          return true;
        }
        return false;

      case 'bw':
        if (action.startsWith('q:')) {
          const quality = action.slice(2);
          if (quality !== 'low' && quality !== 'medium' && quality !== 'high') return false;
          operation.quality = quality;
          return true;
        }
        if (action.startsWith('th:')) {
          const threshold = action.slice(3);
          if (threshold !== 'light' && threshold !== 'balanced' && threshold !== 'strong') {
            return false;
          }
          operation.threshold = threshold;
          return true;
        }
        return false;

      case 'clear':
        if (action.startsWith('q:')) {
          const quality = action.slice(2);
          if (quality !== 'low' && quality !== 'medium' && quality !== 'high') return false;
          operation.quality = quality;
          return true;
        }
        if (action.startsWith('cl:')) {
          const level = action.slice(3);
          if (level !== 'low' && level !== 'medium' && level !== 'high') return false;
          operation.clearLevel = level;
          return true;
        }
        return false;

      case 'nup':
        if (action.startsWith('np:')) {
          const value = Number(action.slice(3));
          if (value !== 2 && value !== 4 && value !== 6 && value !== 9) return false;
          operation.settings.perPage = value as 2 | 4 | 6 | 9;
          return true;
        }
        if (action.startsWith('pa:')) {
          const paper = action.slice(3);
          if (!['a4', 'a3', 'a5', 'letter', 'legal'].includes(paper)) return false;
          operation.settings.paper = paper as typeof operation.settings.paper;
          return true;
        }
        if (action.startsWith('or:')) {
          const orientation = action.slice(3);
          if (!['portrait', 'landscape', 'auto'].includes(orientation)) return false;
          operation.settings.orientation = orientation as typeof operation.settings.orientation;
          return true;
        }
        if (action.startsWith('mg:')) {
          const margin = action.slice(3);
          if (!['compact', 'normal', 'wide'].includes(margin)) return false;
          operation.settings.margin = margin as typeof operation.settings.margin;
          return true;
        }
        if (action.startsWith('gp:')) {
          const gap = Number(action.slice(3));
          if (gap !== 0 && gap !== 8 && gap !== 16) return false;
          operation.settings.gap = gap as 0 | 8 | 16;
          return true;
        }
        if (action === 'sep:0' || action === 'sep:1') {
          operation.settings.separators = action === 'sep:1';
          return true;
        }
        if (action === 'pn:0' || action === 'pn:1') {
          operation.settings.pageNumbers = action === 'pn:1';
          return true;
        }
        if (action === 'ns:start') {
          setPrompt(workspace, operation, 'number-start');
          return true;
        }
        if (action.startsWith('pp:')) {
          const position = action.slice(3);
          if (!['bottom-center', 'bottom-right', 'top-center'].includes(position)) return false;
          operation.settings.numberPosition =
            position as typeof operation.settings.numberPosition;
          return true;
        }
        if (action.startsWith('ps:')) {
          const size = Number(action.slice(3));
          if (size !== 8 && size !== 10 && size !== 12) return false;
          operation.settings.numberSize = size;
          return true;
        }
        return false;

      case 'watermark':
        if (action === 'wm:text') {
          setPrompt(workspace, operation, 'watermark-text');
          return true;
        }
        if (action.startsWith('wm:size:')) {
          const size = Number(action.slice('wm:size:'.length));
          if (size !== 32 && size !== 48 && size !== 64 && size !== 96) return false;
          operation.size = size;
          return true;
        }
        if (action.startsWith('wm:opacity:')) {
          const opacity = Number(action.slice('wm:opacity:'.length));
          if (opacity !== 15 && opacity !== 25 && opacity !== 40 && opacity !== 60) return false;
          operation.opacity = opacity / 100;
          return true;
        }
        if (action.startsWith('wm:rot:')) {
          const rotation = Number(action.slice('wm:rot:'.length));
          if (rotation !== 0 && rotation !== 45 && rotation !== 90) return false;
          operation.rotation = rotation;
          return true;
        }
        if (action.startsWith('wm:pos:')) {
          const position = action.slice('wm:pos:'.length);
          if (
            !['center', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(
              position,
            )
          ) {
            return false;
          }
          operation.position = position as WatermarkPosition;
          return true;
        }
        if (action === 'wm:scope:all') {
          operation.scope = 'all';
          operation.indices = undefined;
          return true;
        }
        if (action === 'wm:scope:selected' || action === 'wm:pages') {
          operation.scope = 'selected';
          setPrompt(workspace, operation, 'ranges');
          return true;
        }
        return false;

      case 'metadata':
        if (action === 'md:title') {
          setPrompt(workspace, operation, 'metadata-title');
          return true;
        }
        if (action === 'md:author') {
          setPrompt(workspace, operation, 'metadata-author');
          return true;
        }
        if (action === 'md:subject') {
          setPrompt(workspace, operation, 'metadata-subject');
          return true;
        }
        if (action === 'md:keywords') {
          setPrompt(workspace, operation, 'metadata-keywords');
          return true;
        }
        return false;

      case 'timestamp':
        if (action === 'ts:text') {
          setPrompt(workspace, operation, 'timestamp-text');
          return true;
        }
        return false;

      case 'footer':
        if (action === 'ft:text') {
          setPrompt(workspace, operation, 'footer-text');
          return true;
        }
        if (action === 'ft:num:0' || action === 'ft:num:1') {
          operation.pageNumbers = action === 'ft:num:1';
          return true;
        }
        if (action === 'ft:ts:0' || action === 'ft:ts:1') {
          operation.timestamp = action === 'ft:ts:1';
          return true;
        }
        if (action.startsWith('ft:pos:')) {
          const position = action.slice('ft:pos:'.length);
          if (!['left', 'center', 'right'].includes(position)) return false;
          operation.position = position as FooterPosition;
          return true;
        }
        if (action.startsWith('ft:size:')) {
          const size = Number(action.slice('ft:size:'.length));
          if (size !== 8 && size !== 10 && size !== 12) return false;
          operation.size = size;
          return true;
        }
        return false;
    }
  }

  function applyText(
    operation: WorkspaceOperation,
    field: AwaitingField,
    text: string,
    pages: number,
  ): void {
    switch (field) {
      case 'ranges': {
        if (
          operation.type !== 'split' &&
          operation.type !== 'select' &&
          operation.type !== 'rotate' &&
          operation.type !== 'watermark'
        ) {
          throw new WorkspaceInputError('ws.err.invalidRanges');
        }
        let indices: number[];
        try {
          indices = parsePageRanges(text, pages, 'subset');
        } catch {
          throw new WorkspaceInputError('ws.err.invalidRanges');
        }
        operation.indices = indices;
        operation.rangesText = text;
        return;
      }
      case 'order': {
        let indices: number[];
        try {
          indices = parsePageRanges(text, pages, 'permutation');
        } catch {
          throw new WorkspaceInputError('ws.err.invalidOrder');
        }
        if (operation.type === 'reorder') {
          operation.indices = indices;
          operation.rangesText = text;
        }
        return;
      }
      case 'group-size': {
        let size: number;
        try {
          size = parseGroupSize(text, pages);
        } catch {
          throw new WorkspaceInputError('ws.err.invalidGroupSize', { pages });
        }
        if (operation.type === 'split') operation.groupSize = size;
        return;
      }
      case 'number-start': {
        const value = Number(text);
        if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
          throw new WorkspaceInputError('ws.err.invalidNumber');
        }
        if (operation.type === 'nup') operation.settings.numberStart = value;
        return;
      }
      case 'watermark-text': {
        if (operation.type !== 'watermark') return;
        if (!text) throw new WorkspaceInputError('ws.err.emptyText');
        if (text.length > 100) throw new WorkspaceInputError('ws.err.textTooLong', { max: 100 });
        if (!isPdfTextDrawable(text)) {
          throw new WorkspaceInputError('ws.err.unsupportedText');
        }
        operation.text = text;
        return;
      }
      case 'footer-text': {
        if (operation.type !== 'footer') return;
        const value = text === '-' ? '' : text;
        if (value.length > 120) throw new WorkspaceInputError('ws.err.textTooLong', { max: 120 });
        if (value && !isPdfTextDrawable(value)) {
          throw new WorkspaceInputError('ws.err.unsupportedText');
        }
        operation.text = value;
        return;
      }
      case 'timestamp-text': {
        if (operation.type !== 'timestamp') return;
        const value = text === '-' ? '' : text;
        if (value.length > 200) throw new WorkspaceInputError('ws.err.textTooLong', { max: 200 });
        if (value && !isPdfTextDrawable(value)) {
          throw new WorkspaceInputError('ws.err.unsupportedText');
        }
        operation.customText = value;
        return;
      }
      case 'metadata-title':
      case 'metadata-author':
      case 'metadata-subject':
      case 'metadata-keywords': {
        if (operation.type !== 'metadata') return;
        const value = text === '-' ? '' : text;
        if (value.length > 300) {
          throw new WorkspaceInputError('ws.err.metadataTooLong', { max: 300 });
        }
        if (field === 'metadata-title') operation.title = value;
        else if (field === 'metadata-author') operation.author = value;
        else if (field === 'metadata-subject') operation.subject = value;
        else operation.keywords = value;
        return;
      }
    }
  }

  bot.callbackQuery('menu:new', async (ctx) => {
    await ctx.answerCallbackQuery();
    await openWorkspace(ctx, true);
  });

  bot.callbackQuery('menu:workspace', async (ctx) => {
    await ctx.answerCallbackQuery();
    await openWorkspace(ctx, false);
  });

  bot.command('workspace', async (ctx) => {
    await openWorkspace(ctx, false);
  });

  bot.callbackQuery('ws:new', async (ctx) => {
    await ctx.answerCallbackQuery();
    await openWorkspace(ctx, true);
  });

  bot.callbackQuery('ws:open', async (ctx) => {
    await ctx.answerCallbackQuery();
    await openWorkspace(ctx, false);
  });

  bot.callbackQuery('ws:add', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const { workspace, lang } = found;
    if (workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    workspace.awaitingUpload = true;
    workspace.replacingFileId = null;
    workspaces.touch(workspace.userId);
    await ctx.answerCallbackQuery();
    await showWorkspace(ctx, workspace, lang);
  });

  bot.callbackQuery('ws:back', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    found.workspace.replacingFileId = null;
    found.workspace.awaitingUpload = false;
    workspaces.touch(found.workspace.userId);
    await ctx.answerCallbackQuery();
    await showWorkspace(ctx, found.workspace, found.lang);
  });

  bot.callbackQuery('ws:more', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    if (found.workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(found.lang, 'ws.run.busy'), show_alert: true });
      await showWorkspace(ctx, found.workspace, found.lang);
      return;
    }
    await ctx.answerCallbackQuery();
    await showPanel(ctx, moreOptionsPanel(found.lang, found.workspace));
  });

  bot.callbackQuery('ws:files', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    await ctx.answerCallbackQuery();
    await showPanel(ctx, workspaceFilesPanel(found.lang, found.workspace));
  });

  bot.callbackQuery(/^ws:file:sel:(.+)$/, async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const id = /^ws:file:sel:(.+)$/.exec(ctx.callbackQuery.data ?? '')?.[1];
    if (!id || !found.workspace.files.some((file) => file.id === id)) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await showPanel(ctx, fileActionsPanel(found.lang, found.workspace, id));
  });

  bot.callbackQuery('ws:repcancel', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    found.workspace.replacingFileId = null;
    found.workspace.awaitingUpload = false;
    workspaces.touch(found.workspace.userId);
    await ctx.answerCallbackQuery();
    await showPanel(ctx, workspaceFilesPanel(found.lang, found.workspace));
  });

  bot.callbackQuery(/^ws:file:(rm|up|dn|rp):(.+)$/, async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const { workspace, lang } = found;
    if (workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    const match = /^ws:file:(rm|up|dn|rp):(.+)$/.exec(ctx.callbackQuery.data ?? '');
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    const action = match[1]!;
    const id = match[2]!;
    const index = workspace.files.findIndex((file) => file.id === id);
    if (index < 0) {
      await ctx.answerCallbackQuery();
      await showPanel(ctx, workspaceFilesPanel(lang, workspace));
      return;
    }

    if (action === 'rp') {
      const file = workspace.files[index]!;
      workspace.replacingFileId = file.id;
      workspace.awaitingUpload = true;
      workspaces.touch(workspace.userId);
      await ctx.answerCallbackQuery();
      await showPanel(ctx, replacePromptPanel(lang, workspace, file.id));
      return;
    }

    if (action === 'rm') {
      const [removed] = workspace.files.splice(index, 1);
      if (removed) {
        await cleanupFile(removed.path).catch((error: unknown) => {
          logger.warn('temp_cleanup_failed', { userId: workspace.userId }, error);
        });
      }
      if (workspace.replacingFileId === id) {
        workspace.replacingFileId = null;
        workspace.awaitingUpload = false;
      }
      if (workspace.files.length === 0) workspace.status = 'collecting';
      workspaces.touch(workspace.userId);
      await ctx.answerCallbackQuery({
        text: t(lang, 'ws.files.removed', { name: removed?.name ?? '' }),
      });
      await showPanel(ctx, workspaceFilesPanel(lang, workspace));
      return;
    }

    const target = action === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= workspace.files.length) {
      await ctx.answerCallbackQuery();
      return;
    }
    const [file] = workspace.files.splice(index, 1);
    if (!file) {
      await ctx.answerCallbackQuery();
      return;
    }
    workspace.files.splice(target, 0, file);
    workspaces.touch(workspace.userId);
    await ctx.answerCallbackQuery();
    await showPanel(ctx, fileActionsPanel(lang, workspace, file.id));
  });

  bot.callbackQuery('ws:ops', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    await ctx.answerCallbackQuery();
    await showPanel(ctx, workspaceOperationsPanel(found.lang, found.workspace));
  });

  bot.callbackQuery('ws:tools', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    if (found.workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(found.lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await showPanel(ctx, advancedToolsPanel(found.lang));
  });

  bot.callbackQuery(/^ws:cat:([a-z]+)$/, async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const category = ctx.callbackQuery.data?.slice('ws:cat:'.length);
    if (
      category !== 'organization' &&
      category !== 'color' &&
      category !== 'layout' &&
      category !== 'personalization'
    ) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    await showPanel(ctx, operationsCatalogPanel(found.lang, category as OperationCategory));
  });

  bot.callbackQuery(/^ws:addop:([a-z]+)$/, async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const { workspace, lang } = found;
    if (workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    const type = ctx.callbackQuery.data?.slice('ws:addop:'.length);
    if (!type || !isOperationType(type)) {
      await ctx.answerCallbackQuery();
      return;
    }
    if (workspace.files.length === 0) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.err.noFiles'), show_alert: true });
      return;
    }
    workspace.presetId = null;
    const operation = addOperation(workspace, type);
    workspaces.touch(workspace.userId);
    await ctx.answerCallbackQuery({
      text: t(lang, 'ws.ops.added', { label: t(lang, operationLabelKey(type)) }),
    });
    await showPanel(
      ctx,
      operationConfigPanel(lang, workspace, workspace.operations.indexOf(operation), config),
    );
  });

  bot.callbackQuery(/^ws:op:(conf|rm|up|dn):(\d+)$/, async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const { workspace, lang } = found;
    if (workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    const match = /^ws:op:(conf|rm|up|dn):(\d+)$/.exec(ctx.callbackQuery.data ?? '');
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    const action = match[1]!;
    const index = Number(match[2]);

    if (action === 'conf') {
      await ctx.answerCallbackQuery();
      await showPanel(ctx, operationConfigPanel(lang, workspace, index, config));
      return;
    }

    if (action === 'rm') {
      if (!removeOperation(workspace, index)) {
        await ctx.answerCallbackQuery();
        return;
      }
      workspace.presetId = null;
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.ops.removed') });
    } else {
      if (!moveOperation(workspace, index, action === 'up' ? 'up' : 'down')) {
        await ctx.answerCallbackQuery();
        return;
      }
      workspace.presetId = null;
      await ctx.answerCallbackQuery();
    }

    workspaces.touch(workspace.userId);
    await showPanel(ctx, workspaceOperationsPanel(lang, workspace));
  });

  bot.callbackQuery(/^ws:set:(\d+):(.+)$/, async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const { workspace, lang } = found;
    if (workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    const match = /^ws:set:(\d+):(.+)$/.exec(ctx.callbackQuery.data ?? '');
    if (!match) {
      await ctx.answerCallbackQuery();
      return;
    }
    const index = Number(match[1]);
    const action = match[2]!;
    const operation = workspace.operations[index];
    if (!operation || !applySetting(workspace, operation, action)) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.err.badSettings'), show_alert: true });
      return;
    }
    workspaces.touch(workspace.userId);
    await ctx.answerCallbackQuery();
    await showPanel(ctx, operationConfigPanel(lang, workspace, index, config));
  });

  bot.callbackQuery('ws:clearops', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    if (found.workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(found.lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    clearOperations(found.workspace);
    found.workspace.presetId = null;
    workspaces.touch(found.workspace.userId);
    await ctx.answerCallbackQuery({ text: t(found.lang, 'ws.ops.cleared') });
    await showWorkspace(ctx, found.workspace, found.lang);
  });

  bot.callbackQuery('ws:presets', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    if (found.workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(found.lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await showPanel(ctx, presetsPanel(found.lang, found.workspace));
  });

  bot.callbackQuery(/^ws:preset:([a-z]+)$/, async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const { workspace, lang } = found;
    if (workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    if (workspace.files.length === 0) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.err.noFiles'), show_alert: true });
      return;
    }
    const id = ctx.callbackQuery.data?.slice('ws:preset:'.length);
    if (!id || !isPresetId(id)) {
      await ctx.answerCallbackQuery();
      return;
    }
    applyPreset(workspace, id);
    workspaces.touch(workspace.userId);
    await ctx.answerCallbackQuery({
      text: t(lang, 'ws.presets.applied', { name: presetLabel(lang, id) }),
    });
    await showPanel(ctx, presetSummaryPanel(lang, workspace, config).panel);
  });

  bot.callbackQuery('ws:merge', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const { workspace, lang } = found;
    if (workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    if (workspace.files.length === 0) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.err.noFiles'), show_alert: true });
      return;
    }
    applyPreset(workspace, 'original');
    workspaces.touch(workspace.userId);
    await ctx.answerCallbackQuery({ text: t(lang, 'ws.merge.applied') });
    await showPanel(ctx, presetSummaryPanel(lang, workspace, config).panel);
  });

  bot.callbackQuery('ws:custom', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const { workspace, lang } = found;
    if (workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    if (workspace.files.length === 0) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.err.noFiles'), show_alert: true });
      return;
    }
    if (!workspace.presetId && workspace.operations.length === 0) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.custom.noPreset'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await showPanel(ctx, customSettingsPanel(lang, workspace));
  });

  bot.callbackQuery(/^ws:custom:(.+)$/, async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const { workspace, lang } = found;
    if (workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    const action = ctx.callbackQuery.data?.slice('ws:custom:'.length) ?? '';
    if (!applyPresetCustomization(workspace, action)) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.err.badSettings'), show_alert: true });
      return;
    }
    workspaces.touch(workspace.userId);
    await ctx.answerCallbackQuery();
    await showPanel(ctx, customSettingsPanel(lang, workspace));
  });

  const showSummary = async (ctx: Context): Promise<void> => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const summary = presetSummaryPanel(found.lang, found.workspace, config);
    await ctx.answerCallbackQuery(
      summary.ok ? undefined : { text: t(found.lang, 'ws.run.notReady'), show_alert: true },
    );
    await showPanel(ctx, summary.panel);
  };

  bot.callbackQuery('ws:summary', showSummary);
  bot.callbackQuery('ws:review', showSummary);

  bot.callbackQuery('ws:mode', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    await ctx.answerCallbackQuery();
    await showPanel(ctx, modePanel(found.lang, found.workspace));
  });

  bot.callbackQuery(/^ws:mode:(c|i)$/, async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    const { workspace, lang } = found;
    if (workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    workspace.mode = ctx.callbackQuery.data?.endsWith(':i') ? 'individual' : 'combine';
    workspaces.touch(workspace.userId);
    await ctx.answerCallbackQuery();
    await showPanel(ctx, modePanel(lang, workspace));
  });

  bot.callbackQuery('ws:cancelrun', async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    const lang = langOf(ctx, deps);
    const workspace = workspaces.get(ctx.from.id);
    if (workspace && workspace.chatId !== ctx.chat?.id) {
      await ctx.answerCallbackQuery({
        text: t(lang, 'ws.upload.otherChat'),
        show_alert: true,
      });
      return;
    }
    if (!workspace || !(workspace.status === 'processing' || jobRunner.isActive(ctx.from.id))) {
      await ctx.answerCallbackQuery();
      if (workspace) await showWorkspace(ctx, workspace, lang);
      return;
    }
    workspace.cancelRequested = true;
    jobRunner.cancel(ctx.from.id);
    workspace.controller.abort();
    workspaces.touch(workspace.userId);
    await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.cancelling') });
  });

  bot.callbackQuery('ws:cancel', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    if (found.workspace.status === 'processing') {
      await ctx.answerCallbackQuery({ text: t(found.lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery();
    await showPanel(ctx, cancelConfirmPanel(found.lang));
  });

  bot.callbackQuery('ws:cancelkeep', async (ctx) => {
    const found = await requireWorkspace(ctx);
    if (!found) return;
    found.workspace.replacingFileId = null;
    found.workspace.awaitingUpload = false;
    workspaces.touch(found.workspace.userId);
    await ctx.answerCallbackQuery();
    await showPanel(ctx, moreOptionsPanel(found.lang, found.workspace));
  });

  bot.callbackQuery('ws:cancelconfirm', async (ctx) => {
    if (!ctx.from) {
      await ctx.answerCallbackQuery();
      return;
    }
    const lang = langOf(ctx, deps);
    const workspace = workspaces.get(ctx.from.id);
    if (workspace && workspace.chatId !== ctx.chat?.id) {
      await ctx.answerCallbackQuery({
        text: t(lang, 'ws.upload.otherChat'),
        show_alert: true,
      });
      return;
    }
    const removed = workspaces.clear(ctx.from.id);
    await ctx.answerCallbackQuery();
    if (!removed) {
      await editOrReply(
        ctx,
        t(lang, 'ws.expired'),
        new InlineKeyboard()
          .text(t(lang, 'ws.run.newWorkspace'), 'ws:new')
          .row()
          .text(t(lang, 'ws.btn.menu'), 'menu:home'),
      );
      return;
    }
    if (removed.status === 'processing') {
      removed.cancelRequested = true;
      jobRunner.cancel(removed.userId);
      removed.controller.abort();
    }
    await Promise.all(
      removed.files.map((file) =>
        cleanupFile(file.path).catch((error: unknown) => {
          logger.warn('temp_cleanup_failed', { userId: removed.userId }, error);
        }),
      ),
    );
    await editOrReply(
      ctx,
      t(lang, 'ws.run.expiredNote'),
      new InlineKeyboard()
        .text(t(lang, 'ws.run.newWorkspace'), 'ws:new')
        .row()
        .text(t(lang, 'ws.btn.menu'), 'menu:home'),
    );
  });

  bot.callbackQuery('ws:run', async (ctx) => {
    await runWorkspace(ctx, bot, deps);
  });

  bot.callbackQuery('ws:retry', async (ctx) => {
    await runWorkspace(ctx, bot, deps);
  });


  async function runWorkspace(
    ctx: Context,
    botInstance: Bot,
    depsForRun: BotDeps,
  ): Promise<void> {
    if (!ctx.from || !ctx.chat) {
      await ctx.answerCallbackQuery();
      return;
    }
    const userId = ctx.from.id;
    const workspace = depsForRun.workspaces.get(userId);
    if (!workspace) {
      await ctx.answerCallbackQuery({
        text: t(langOf(ctx, depsForRun), 'ws.expired'),
        show_alert: true,
      });
      return;
    }
    const lang = langOf(ctx, depsForRun);

    if (workspace.status === 'processing' || jobRunner.isActive(userId)) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }
    if (workspace.uploading) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.upload.busy'), show_alert: true });
      return;
    }

    const summary = presetSummaryPanel(lang, workspace, config);
    if (!summary.ok) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.notReady'), show_alert: true });
      await showPanel(ctx, summary.panel);
      return;
    }

    const controller = jobRunner.tryStart(userId);
    if (!controller) {
      await ctx.answerCallbackQuery({ text: t(lang, 'ws.run.busy'), show_alert: true });
      return;
    }

    workspace.controller = controller;
    workspace.status = 'processing';
    workspace.processingStartedAt = Date.now();
    workspace.processingCompletedAt = null;
    workspace.lastError = null;
    workspace.cancelRequested = false;
    workspace.awaitingText = null;
    workspace.awaitingUpload = false;
    workspaces.touch(userId);

    const chatId = ctx.chat.id;
    const initialText = t(lang, 'ws.run.starting', {
      operations: workspace.operations.length,
      files: workspace.files.length,
    });

    await ctx.answerCallbackQuery();

    const progress = await botInstance.api
      .sendMessage(chatId, initialText, { reply_markup: processingKeyboard(lang) })
      .catch(() => null);

    const editProgress = async (text: string): Promise<void> => {
      if (!progress) return;
      try {
        await botInstance.api.editMessageText(chatId, progress.message_id, text, {
          reply_markup: processingKeyboard(lang),
        });
      } catch {
        // The message may have been deleted or unchanged; the final reply still delivers.
      }
    };

    fileQueue.enqueue(async () => {
      const startedAt = workspace.processingStartedAt ?? Date.now();
      let currentStage: StageEvent | null = null;
      let lastRasterAt = 0;
      let result: PipelineRunResult | null = null;
      const activeFiles = [...workspace.files];

      try {
        result = await runWorkspacePipeline(workspace, {
          tmpDir: config.tmpDir,
          maxOutputBytes,
          maxPages: config.maxPdfPages,
          mergeMaxFiles: config.mergeMaxFiles,
          rasterMaxPages: config.rasterMaxPages,
          rasterMaxPixelsPerPage: config.rasterMaxPixelsPerPage,
          timeoutMs: config.processTimeoutSeconds * 1000,
          signal: controller.signal,
          onStage: (event) => {
            currentStage = event;
            workspaces.touch(userId);
            void editProgress(
              progressText(lang, event.step, event.total, t(lang, operationLabelKey(event.operation.type))),
            );
          },
          onRasterProgress: (event) => {
            const now = Date.now();
            if (event.done !== event.totalPages && now - lastRasterAt < 1200) return;
            lastRasterAt = now;
            void editProgress(
              rasterProgressText(
                lang,
                event.step,
                event.total,
                t(lang, operationLabelKey(event.operation.type)),
                event.done,
                event.totalPages,
              ),
            );
          },
        });

        if (controller.signal.aborted) {
          throw new FileHandlingError('cancelled', 'Pipeline was cancelled');
        }

        await editProgress(t(lang, 'ws.run.sending'));

        const caption = [
          t(lang, 'ws.run.caption'),
          `${t(lang, 'ws.run.pages', { pages: result.totalPages })} · ${t(
            lang,
            'ws.run.output',
            { size: formatBytes(result.outputBytes) },
          )}`,
        ].join('\n');

        await sendDocumentFromPath({
          api: botInstance.api,
          chatId,
          filePath: result.outputPath,
          maxBytes: maxOutputBytes,
          fileName: result.outputName,
          caption,
          replyMarkup: resultKeyboard(lang),
        });

        const completedAt = Date.now();
        workspace.processingCompletedAt = completedAt;
        const finished = workspaces.clear(userId) ?? workspace;
        await Promise.all(
          finished.files.map((file) =>
            cleanupFile(file.path).catch((error: unknown) => {
              logger.warn('temp_cleanup_failed', { userId }, error);
            }),
          ),
        );

        const completion = completionText(lang, {
          outputName: result.outputName,
          zip: result.zip,
          fileCount: result.outputs.length,
          pages: result.totalPages,
          tools: result.operationCount,
          outputBytes: result.outputBytes,
          durationMs: completedAt - startedAt,
        });

        if (progress) {
          try {
            await botInstance.api.editMessageText(chatId, progress.message_id, completion, {
              reply_markup: resultKeyboard(lang),
            });
          } catch {
            await botInstance.api
              .sendMessage(chatId, completion, { reply_markup: resultKeyboard(lang) })
              .catch(() => undefined);
          }
        }

        logger.info('workspace_processed', {
          userId,
          chatId,
          files: activeFiles.length,
          operations: result.operationCount,
          pages: result.totalPages,
          outputBytes: result.outputBytes,
          zip: result.zip,
          durationMs: completedAt - startedAt,
        });
      } catch (error) {
        const current = workspaces.get(userId);
        const stillActive = current === workspace;

        if (controller.signal.aborted || workspace.cancelRequested) {
          if (stillActive) {
            workspace.status = 'ready';
            workspace.cancelRequested = false;
            workspace.processingCompletedAt = Date.now();
            workspace.lastError = null;
            workspace.controller = new AbortController();
            workspaces.touch(userId);
          }
          const cancelledText = [t(lang, 'ws.run.cancelled'), '', t(lang, 'ws.run.cancelledKept')].join(
            '\n',
          );
          await editProgress(cancelledText);
          if (progress && stillActive) {
            try {
              await botInstance.api.editMessageReplyMarkup(chatId, progress.message_id, {
                reply_markup: retryKeyboard(lang),
              });
            } catch {
              // The progress message may no longer exist.
            }
          } else if (!progress && stillActive) {
            await botInstance.api
              .sendMessage(chatId, cancelledText, { reply_markup: retryKeyboard(lang) })
              .catch(() => undefined);
          }
        } else {
          const message = fileErrorMessage(lang, error, {
            maxUploadMb: config.maxUploadMb,
            maxOutputMb: config.maxOutputMb,
          });
          const stage = currentStage as StageEvent | null;
          const failedLabel = stage
            ? t(lang, operationLabelKey(stage.operation.type))
            : undefined;
          if (stillActive) {
            workspace.status = 'failed';
            workspace.processingCompletedAt = Date.now();
            workspace.lastError = message;
            workspaces.touch(userId);
          }
          logger.warn('workspace_failed', { userId, chatId }, error);
          if (progress) {
            try {
              await botInstance.api.editMessageText(
                chatId,
                progress.message_id,
                failureText(lang, message, failedLabel),
                { reply_markup: retryKeyboard(lang) },
              );
            } catch {
              await botInstance.api
                .sendMessage(chatId, failureText(lang, message, failedLabel), {
                  reply_markup: retryKeyboard(lang),
                })
                .catch(() => undefined);
            }
          } else {
            await botInstance.api
              .sendMessage(chatId, failureText(lang, message, failedLabel), {
                reply_markup: retryKeyboard(lang),
              })
              .catch(() => undefined);
          }
        }
      } finally {
        if (result) await cleanupWorkspaceRun(result);
        jobRunner.finish(userId);
        if (workspaces.get(userId) === workspace) workspaces.touch(userId);
      }
    });
  }

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from || !ctx.chat) return;
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();

    const workspace = workspaces.get(ctx.from.id);
    if (!workspace || workspace.chatId !== ctx.chat.id) return next();
    const awaiting = workspace.awaitingText;
    if (!awaiting) return next();
    if (workspace.status === 'processing') return next();

    const operation = findOperation(workspace, awaiting.operationId);
    if (!operation) {
      workspace.awaitingText = null;
      return next();
    }

    const lang = langOf(ctx, deps);
    const pages = promptPages(workspace, operation);

    try {
      applyText(operation, awaiting.field, text, pages);
    } catch (error) {
      const message =
        error instanceof WorkspaceInputError
          ? t(lang, error.key, error.params)
          : t(lang, 'ws.err.invalidRanges');
      await ctx.reply(t(lang, 'ws.prompt.invalid', { error: message }));
      return;
    }

    workspace.awaitingText = null;
    workspaces.touch(workspace.userId);
    const index = workspace.operations.indexOf(operation);
    const panel = operationConfigPanel(lang, workspace, index, config);
    await ctx.reply(panel.text, { reply_markup: panel.keyboard });
  });

  bot.on('message:document', async (ctx, next) => {
    if (!ctx.from || !ctx.chat) return;

    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const workspace = workspaces.get(userId);

    if (!workspace) {
      if (
        deps.uploadSessions.isActive(userId) ||
        deps.mergeSessions.get(userId) ||
        deps.toolSessions.get(userId)
      ) {
        return next();
      }
      const lang = langOf(ctx, deps);
      await ctx.reply(t(lang, 'ws.upload.noWorkspace'), {
        reply_markup: new InlineKeyboard()
          .text(t(lang, 'menu.newWorkspace'), 'ws:new')
          .row()
          .text(t(lang, 'ws.btn.menu'), 'menu:home'),
      });
      return;
    }
    if (workspace.chatId !== chatId) {
      const lang = langOf(ctx, deps);
      await ctx.reply(t(lang, 'ws.upload.otherChat'));
      return;
    }

    const lang = langOf(ctx, deps);

    if (workspace.status === 'processing') {
      await ctx.reply(t(lang, 'ws.run.busy'));
      return;
    }
    if (!workspace.awaitingUpload && !workspace.replacingFileId) {
      await ctx.reply(t(lang, 'ws.upload.notNow'));
      return;
    }
    if (workspace.uploading) {
      await ctx.reply(t(lang, 'ws.upload.busy'));
      return;
    }
    if (!(await ensureMembership(ctx, deps))) return;

    const document = ctx.message.document;
    const validation = validatePdfMetadata(document, maxBytes);
    if (!validation.ok) {
      await replyValidationError(ctx, lang, validation.code);
      return;
    }

    const replacingId = workspace.replacingFileId;
    const existing = workspace.files.find(
      (file) => file.fileUniqueId === document.file_unique_id && file.id !== replacingId,
    );
    if (existing) {
      await ctx.reply(t(lang, 'ws.upload.duplicate'));
      return;
    }

    if (!replacingId && workspace.files.length >= MAX_WORKSPACE_FILES) {
      await ctx.reply(t(lang, 'ws.upload.fileLimit', { max: MAX_WORKSPACE_FILES }));
      return;
    }

    const declaredSize = validation.declaredSize ?? maxBytes;
    const currentBytes = workspace.files
      .filter((file) => file.id !== replacingId)
      .reduce((sum, file) => sum + file.sizeBytes, 0);
    if (currentBytes + declaredSize > maxTotalBytes) {
      await ctx.reply(t(lang, 'ws.upload.totalSize', { max: config.mergeMaxTotalMb }));
      return;
    }

    try {
      const disk = await checkDiskSpace(config.tmpDir, declaredSize, reserveBytes);
      if (!disk.ok) {
        await ctx.reply(t(lang, 'ws.upload.lowDisk'));
        return;
      }
    } catch (error) {
      logger.warn('disk_check_failed', { userId }, error);
      await ctx.reply(t(lang, 'ws.upload.diskCheck'));
      return;
    }

    const limit = uploadRateLimiter.tryAcquire(userId);
    if (!limit.allowed) {
      const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
      await ctx.reply(t(lang, 'ws.upload.tooMany', { minutes }));
      return;
    }

    workspace.uploading = true;
    workspace.awaitingUpload = false;
    const signal = workspace.controller.signal;
    const fileId = document.file_id;
    const label = document.file_name?.trim() || 'document.pdf';
    const uniqueId = document.file_unique_id;
    const replacingFile = replacingId
      ? workspace.files.find((file) => file.id === replacingId) ?? null
      : null;

    await ctx.reply(t(lang, 'ws.upload.receiving', { name: label }));

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

        if (signal.aborted || workspaces.get(userId) !== workspace) {
          await cleanupFile(intake.filePath).catch(() => undefined);
          return;
        }

        const pages = await countPdfPages(intake.filePath);
        if (pages > config.maxPdfPages) {
          throw new FileHandlingError('too_many_pages', 'PDF exceeds the page limit');
        }

        const otherPages = workspace.files
          .filter((file) => file.id !== replacingId)
          .reduce((sum, file) => sum + file.pages, 0);
        if (otherPages + pages > config.maxPdfPages) {
          await cleanupFile(intake.filePath).catch(() => undefined);
          intake = null;
          workspace.uploading = false;
          workspace.awaitingUpload = true;
          await bot.api
            .sendMessage(chatId, t(lang, 'ws.upload.totalPages', { max: config.maxPdfPages }))
            .catch(() => undefined);
          return;
        }

        const otherBytes = workspace.files
          .filter((file) => file.id !== replacingId)
          .reduce((sum, file) => sum + file.sizeBytes, 0);
        if (otherBytes + intake.sizeBytes > maxTotalBytes) {
          await cleanupFile(intake.filePath).catch(() => undefined);
          intake = null;
          workspace.uploading = false;
          workspace.awaitingUpload = true;
          await bot.api
            .sendMessage(chatId, t(lang, 'ws.upload.totalSize', { max: config.mergeMaxTotalMb }))
            .catch(() => undefined);
          return;
        }

        const uploadedAt = Date.now();

        if (replacingFile && replacingId) {
          const previousPath = replacingFile.path;
          replacingFile.fileUniqueId = uniqueId;
          replacingFile.path = intake.filePath;
          replacingFile.name = label;
          replacingFile.sizeBytes = intake.sizeBytes;
          replacingFile.pages = pages;
          replacingFile.uploadedAt = uploadedAt;
          intake = null;
          await cleanupFile(previousPath).catch((error: unknown) => {
            logger.warn('temp_cleanup_failed', { userId }, error);
          });
        } else {
          const file: WorkspaceFile = {
            id: `f${workspace.nextFileSeq}`,
            fileUniqueId: uniqueId,
            path: intake.filePath,
            name: label,
            sizeBytes: intake.sizeBytes,
            pages,
            uploadedAt,
          };
          workspace.nextFileSeq += 1;
          workspace.files.push(file);
          intake = null;
        }

        workspace.replacingFileId = null;
        workspace.uploading = false;
        workspace.awaitingUpload = !replacingFile;
        workspace.uploadStartedAt = uploadedAt;
        workspace.status = 'ready';
        workspaces.touch(userId);

        const panel = workspacePanel(lang, workspace, config);
        const notice = replacingFile
          ? t(lang, 'ws.upload.replaced', {
              name: label,
              pages,
              size: formatBytes(workspace.files.find((file) => file.id === replacingId)?.sizeBytes ?? 0),
            })
          : t(lang, 'ws.upload.added', {
              name: label,
              pages,
              size: formatBytes(workspace.files[workspace.files.length - 1]?.sizeBytes ?? 0),
            });

        await bot.api
          .sendMessage(chatId, `${notice}\n\n${panel.text}`, { reply_markup: panel.keyboard })
          .catch(() => undefined);

        logger.info('workspace_file_added', {
          userId,
          chatId,
          pages,
          sizeBytes: workspace.files[workspace.files.length - 1]?.sizeBytes ?? 0,
          replaced: Boolean(replacingFile),
          files: workspace.files.length,
        });
      } catch (error) {
        if (signal.aborted) return;

        logger.warn('workspace_intake_failed', { userId, chatId }, error);
        workspace.uploading = false;
        workspace.awaitingUpload = true;
        const message = fileErrorMessage(lang, error, {
          maxUploadMb: config.maxUploadMb,
          maxOutputMb: config.maxOutputMb,
        });
        await bot.api
          .sendMessage(chatId, t(lang, 'ws.upload.failed', { error: message }), {
            reply_markup: new InlineKeyboard().text(t(lang, 'ws.btn.add'), 'ws:add'),
          })
          .catch(() => undefined);
      } finally {
        workspace.uploading = false;
        if (intake) {
          await cleanupFile(intake.filePath).catch((error: unknown) => {
            logger.warn('temp_cleanup_failed', { userId }, error);
          });
        }
      }
    });
  });

  async function replyValidationError(
    ctx: Context,
    lang: Lang,
    code: FileHandlingError['code'],
  ): Promise<void> {
    if (code === 'too_large') {
      const keyboard = new InlineKeyboard()
        .url(t(lang, 'menu.compress'), COMPRESSION_URL)
        .row()
        .text(t(lang, 'ws.btn.add'), 'ws:add');
      await ctx.reply(
        [
          t(lang, 'err.tooLarge', { max: config.maxUploadMb }),
          '',
          t(lang, 'compression.external'),
        ].join('\n'),
        { reply_markup: keyboard },
      );
      return;
    }
    await ctx.reply(fileErrorMessage(lang, new FileHandlingError(code, 'Invalid document'), {
      maxUploadMb: config.maxUploadMb,
      maxOutputMb: config.maxOutputMb,
    }));
  }
}
