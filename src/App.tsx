import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import {
  ArrowRight,
  AlertCircle,
  Bot,
  BookOpen,
  CheckCircle,
  FileArchive,
  FileJson,
  Focus,
  FileText,
  List,
  MapPin,
  MousePointer2,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanText,
  Search,
  Settings2,
  Sparkles,
  Tags,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import {
  CardEditor,
  type EditableCardField,
} from './components/CardEditor';
import { ModelCenterModal } from './components/ModelCenterModal';
import type { AiConnectionResult } from './aiClient';
import { evaluateCardQuality } from './cardQuality';
import {
  extractDocumentText,
  importFileKind,
  SUPPORTED_FILE_ACCEPT,
} from './fileImport';
import { PdfReader } from './components/PdfReader';
import {
  WorkflowStepper,
  type WorkflowStep,
} from './components/WorkflowStepper';
import {
  buildAnkiPackage,
  buildAnkiText,
  buildCardsJson,
  downloadBlob,
  exportFileName,
} from './exporters';
import {
  buildTextbookCards,
  createCard,
  DEFAULT_PARSER_TEMPLATE,
  GENERAL_PARSER_TEMPLATE,
  pagesFromExtractedText,
  parseExamCards,
  validateParserTemplate,
} from './parser';
import {
  attachSourceLocations,
  textInsideSourceRect,
} from './sourceLocator';
import {
  clearAiGenerationCache,
  clearDraft,
  loadAiGenerationCache,
  loadDraft,
  saveAiGenerationCache,
  saveDraft,
} from './storage';
import {
  buildWorkspaceBackup,
  parseWorkspaceBackup,
} from './workspace';
import type {
  AppSettings,
  AiProgress,
  AiSettings,
  Card,
  DraftData,
  ExtractedPage,
  ParserTemplate,
  PdfSourceRect,
  PdfProgress,
  TextPage,
} from './types';

const DEFAULT_SETTINGS: AppSettings = {
  activeTab: 'upload',
  parseMode: 'textbook',
  extractMode: 'auto',
  pageStart: '1',
  pageEnd: '30',
  ocrScale: '1.8',
  maxCardsPerPage: '5',
  maxAnswerLength: '220',
  deckName: 'Anki 教材与题库卡片',
  parserTemplate: DEFAULT_PARSER_TEMPLATE,
  ai: {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    jsonMode: true,
    chunkSize: '8000',
    maxChunks: '8',
    cardsPerChunk: '8',
    customInstructions: '',
    requestTimeout: '45',
    maxRetries: '2',
    useCache: true,
  },
};

const buttonSecondary =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40';
const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500';

function cloneTemplate(template: ParserTemplate): ParserTemplate {
  return {
    ...template,
    answerLabels: [...template.answerLabels],
    pointLabels: [...template.pointLabels],
    analysisLabels: [...template.analysisLabels],
    trailingLabels: [...template.trailingLabels],
  };
}

function normalizeDraftSettings(settings: AppSettings): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    parserTemplate: {
      ...cloneTemplate(DEFAULT_PARSER_TEMPLATE),
      ...settings.parserTemplate,
    },
    ai: {
      ...DEFAULT_SETTINGS.ai,
      ...settings.ai,
    },
  };
}

function progressText(progress: PdfProgress | null): string {
  if (!progress) return '';
  if (progress.stage === 'loading') return '正在载入 PDF...';
  if (progress.stage === 'ocr' && progress.total === 100) {
    return `${progress.detail ?? '正在 OCR'}：${progress.completed}%`;
  }
  return `${progress.detail ?? '处理中'}（${progress.completed}/${progress.total}）`;
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitLabels(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((label) => label.trim())
    .filter(Boolean);
}

function cardIdentity(card: Card): string {
  return `${card.question.replace(/\s+/g, '').toLowerCase()}|${card.answer
    .replace(/\s+/g, '')
    .toLowerCase()}`;
}

export default function App() {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('import');
  const [isModelCenterOpen, setIsModelCenterOpen] = useState(false);
  const closeModelCenter = useCallback(() => setIsModelCenterOpen(false), []);
  const [reviewFilter, setReviewFilter] = useState<
    'all' | 'pending' | 'approved' | 'source' | 'quality'
  >('all');
  const [reviewQuery, setReviewQuery] = useState('');
  const [reviewSort, setReviewSort] = useState<
    'original' | 'source' | 'quality' | 'type'
  >('original');
  const [inputText, setInputText] = useState('');
  const [cards, setCards] = useState<Card[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastDeletedSnapshot, setLastDeletedSnapshot] = useState<Card[] | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pdfProgress, setPdfProgress] = useState<PdfProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExportingPackage, setIsExportingPackage] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isTestingAi, setIsTestingAi] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiProgress | null>(null);
  const [aiConnection, setAiConnection] = useState<AiConnectionResult | null>(
    null,
  );
  const [aiRetryAction, setAiRetryAction] = useState<
    'test' | 'generate' | null
  >(null);
  const [apiKey, setApiKey] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [bulkTag, setBulkTag] = useState('');
  const [bulkType, setBulkType] = useState('简答题');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [importedFileNames, setImportedFileNames] = useState<string[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [pdfSourcePages, setPdfSourcePages] = useState<ExtractedPage[]>([]);
  const [workspaceView, setWorkspaceView] = useState<'cards' | 'pdf'>('cards');
  const [sourceCardId, setSourceCardId] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [focusSource, setFocusSource] = useState(true);
  const [isSelectingSource, setIsSelectingSource] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const aiAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void loadDraft()
      .then((draft) => {
        if (!active || !draft || draft.version !== 1) return;
        const restoredCards = draft.cards.map((card) => ({
          ...card,
          origin: card.origin ?? ('local' as const),
          reviewStatus: card.reviewStatus ?? ('approved' as const),
        }));
        setInputText(draft.inputText);
        setCards(restoredCards);
        setSettings(normalizeDraftSettings(draft.settings));
        setCurrentStep(
          restoredCards.length
            ? 'review'
            : draft.inputText.trim()
              ? 'generate'
              : 'import',
        );
        setStatusMessage(
          `已恢复 ${new Date(draft.savedAt).toLocaleString()} 的草稿。`,
        );
      })
      .catch(() => {
        if (active) setErrorMessage('草稿恢复失败，但不影响继续使用。');
      })
      .finally(() => {
        if (active) setDraftReady(true);
      });
    return () => {
      active = false;
      abortControllerRef.current?.abort();
      aiAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    const timeout = window.setTimeout(() => {
      const draft: DraftData = {
        version: 1,
        inputText,
        cards,
        settings,
        savedAt: Date.now(),
      };
      void saveDraft(draft);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [cards, draftReady, inputText, settings]);

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const updateTemplate = <K extends keyof ParserTemplate>(
    key: K,
    value: ParserTemplate[K],
  ) => {
    setSettings((current) => ({
      ...current,
      parserTemplate: {
        ...current.parserTemplate,
        id: 'custom',
        [key]: value,
      },
    }));
  };

  const updateAiSetting = <K extends keyof AiSettings>(
    key: K,
    value: AiSettings[K],
  ) => {
    setAiConnection(null);
    setAiRetryAction(null);
    setSettings((current) => ({
      ...current,
      ai: { ...current.ai, [key]: value },
    }));
  };

  const updateApiKey = (value: string): void => {
    setApiKey(value);
    setAiConnection(null);
    setAiRetryAction(null);
  };

  const replaceCards = (generated: Card[]): void => {
    setCards(generated);
    setSourceCardId(generated[0]?.id ?? null);
    setSelectedIds(new Set());
    setLastDeletedSnapshot(null);
  };

  const generateCards = (
    text: string,
    extractedPages?: TextPage[],
  ): Card[] => {
    if (settings.parseMode === 'exam') {
      const result = parseExamCards(text, settings.parserTemplate);
      if (!result.cards.length) {
        throw new Error(
          result.candidateCount
            ? '找到了题号，但缺少可识别的题干或答案标签。'
            : '未找到符合当前模板的题号，请检查题号正则或切换模板。',
        );
      }
      if (result.skippedCount) {
        setStatusMessage(
          `生成 ${result.cards.length} 张卡片，跳过 ${result.skippedCount} 道不完整题目。`,
        );
      }
      return result.cards;
    }

    const generated = buildTextbookCards(
      extractedPages ?? [{ text }],
      parsePositiveInt(settings.maxAnswerLength, 220),
      parsePositiveInt(settings.maxCardsPerPage, 5),
    );
    return generated;
  };

  const processPastedText = (): void => {
    setErrorMessage('');
    setStatusMessage('正在生成卡片...');
    try {
      const generated = generateCards(
        inputText,
        settings.parseMode === 'textbook'
          ? pdfSourcePages.length
            ? pdfSourcePages
            : pagesFromExtractedText(inputText)
          : undefined,
      );
      replaceCards(attachSourceLocations(generated, pdfSourcePages));
      setCurrentStep(generated.length ? 'review' : 'generate');
      setStatusMessage(
        generated.length
          ? `完成：生成 ${generated.length} 张卡片。`
          : '原文已保留，但本地规则暂未识别出可靠卡片。可检查文本、添加空白卡，或使用 AI 辅助生成候选卡。',
      );
    } catch (error) {
      setErrorMessage((error as Error).message);
      setStatusMessage('');
    }
  };

  const processSourceFiles = async (incomingFiles: File[]): Promise<void> => {
    if (!incomingFiles.length || isProcessing) return;
    const files = incomingFiles.slice(0, 20);
    const supportedFiles = files.filter(
      (file) => importFileKind(file) !== 'unsupported',
    );
    const skippedNames = files
      .filter((file) => importFileKind(file) === 'unsupported')
      .map((file) => file.name);
    if (!supportedFiles.length) {
      setErrorMessage(
        '没有可读取的文件。支持 PDF、DOCX、TXT、Markdown、CSV、TSV、JSON 和 HTML。',
      );
      return;
    }
    const totalBytes = supportedFiles.reduce((total, file) => total + file.size, 0);
    if (totalBytes > 100 * 1024 * 1024) {
      setErrorMessage('单次导入文件总大小不能超过 100 MB。');
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage(`准备读取 ${supportedFiles.length} 个文件...`);
    setPdfProgress({ stage: 'loading', completed: 0, total: 0 });

    try {
      const imported: Array<{
        file: File;
        text: string;
        pages?: ExtractedPage[];
      }> = [];
      const failed: string[] = [];
      for (const [index, file] of supportedFiles.entries()) {
        if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError');
        setStatusMessage(
          `正在读取 ${index + 1}/${supportedFiles.length}：${file.name}`,
        );
        try {
          if (importFileKind(file) === 'pdf') {
            const { extractPdfPages } = await import('./pdf');
            const pages = await extractPdfPages(file, {
              pageStart: parsePositiveInt(settings.pageStart, 1),
              pageEnd: parsePositiveInt(settings.pageEnd, 30),
              extractMode: settings.extractMode,
              ocrScale: Number.parseFloat(settings.ocrScale) || 1.8,
              signal: controller.signal,
              onProgress: setPdfProgress,
            });
            imported.push({
              file,
              pages,
              text: pages
                .map(
                  (page) =>
                    `--- PAGE ${page.page} [${page.method}] ---\n${page.text}`,
                )
                .join('\n\n'),
            });
          } else {
            const text = await extractDocumentText(file);
            if (!text) throw new Error('文件中没有可读取的文本');
            imported.push({ file, text });
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error;
          failed.push(`${file.name}：${(error as Error).message}`);
        }
      }
      if (!imported.length) throw new Error(failed.join('；'));

      const singlePdf =
        imported.length === 1 && importFileKind(imported[0].file) === 'pdf';
      const fullText = imported
        .map((item) =>
          imported.length === 1
            ? item.text
            : `--- FILE: ${item.file.name} ---\n${item.text}`,
        )
        .join('\n\n');
      const extractedPages = singlePdf ? imported[0].pages ?? [] : [];
      const ocrCount = imported.reduce(
        (total, item) =>
          total + (item.pages?.filter((page) => page.method === 'ocr').length ?? 0),
        0,
      );
      setInputText(fullText);
      setImportedFileNames(imported.map((item) => item.file.name));
      setPdfFile(singlePdf ? imported[0].file : null);
      setPdfSourcePages(extractedPages);
      setPreviewPage(extractedPages[0]?.page ?? 1);
      setWorkspaceView('cards');
      let generated: Card[];
      try {
        generated = attachSourceLocations(
          generateCards(fullText, extractedPages),
          extractedPages,
        );
      } catch (error) {
        setErrorMessage(
          `文件已成功读取，但制卡未完成：${(error as Error).message}`,
        );
        setStatusMessage(
          `已读取 ${imported.length} 个文件，提取原文已保留。`,
        );
        setCurrentStep('generate');
        return;
      }
      replaceCards(generated);
      setCurrentStep(generated.length ? 'review' : 'generate');
      setStatusMessage(
        generated.length
          ? singlePdf
            ? `完成：读取 ${extractedPages.length} 页（OCR ${ocrCount} 页），生成 ${generated.length} 张卡片。`
            : `完成：读取 ${imported.length} 个文件${ocrCount ? `（OCR ${ocrCount} 页）` : ''}，生成 ${generated.length} 张卡片。`
          : singlePdf
            ? `PDF 提取完成：读取 ${extractedPages.length} 页（OCR ${ocrCount} 页）。本地规则暂未生成卡片，原文已保留，可直接使用 AI 辅助或添加空白卡。`
            : `已读取 ${imported.length} 个文件。本地规则暂未生成卡片，原文已保留，可直接使用 AI 辅助或添加空白卡。`,
      );
      if (skippedNames.length || failed.length) {
        setErrorMessage(
          [...skippedNames.map((name) => `${name}：格式不支持`), ...failed].join('；'),
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('已取消文件处理，原有卡片未被覆盖。');
      } else {
        setErrorMessage(`文件处理失败：${(error as Error).message}`);
        setStatusMessage('');
      }
    } finally {
      abortControllerRef.current = null;
      setIsProcessing(false);
      setPdfProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    await processSourceFiles(Array.from(event.target.files ?? []));
  };

  const handleFileDrop = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault();
    setIsDraggingFiles(false);
    void processSourceFiles(Array.from(event.dataTransfer.files));
  };

  const cancelProcessing = (): void => {
    abortControllerRef.current?.abort();
  };

  const selectAiProvider = (provider: AiSettings['provider']): void => {
    setAiConnection(null);
    setAiRetryAction(null);
    setSettings((current) => {
      const preset =
        provider === 'deepseek'
          ? {
              baseUrl: 'https://api.deepseek.com',
              model: 'deepseek-v4-flash',
              jsonMode: true,
            }
          : provider === 'ollama'
            ? {
                baseUrl: 'http://localhost:11434/v1',
                model: 'qwen3:8b',
                jsonMode: true,
              }
            : {
                baseUrl: current.ai.baseUrl,
                model: current.ai.model,
                jsonMode: current.ai.jsonMode,
              };
      return {
        ...current,
        ai: { ...current.ai, provider, ...preset },
      };
    });
  };

  const testConnection = async (): Promise<void> => {
    if (isTestingAi || isAiProcessing) return;
    const controller = new AbortController();
    aiAbortControllerRef.current = controller;
    setIsTestingAi(true);
    setAiRetryAction(null);
    setErrorMessage('');
    setStatusMessage('正在测试 AI 接口...');
    try {
      const { testAiConnection } = await import('./ai');
      const result = await testAiConnection(
        { ...settings.ai, apiKey },
        controller.signal,
        fetch,
        (event) => {
          if (event.phase === 'retrying') {
            setStatusMessage(
              `AI 连接测试暂时失败，正在自动重试（${event.attempt}/${event.maxAttempts}）...`,
            );
          }
        },
      );
      setAiConnection(result);
      setStatusMessage(
        `AI 接口连接成功：${result.model} · ${result.latencyMs} ms`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('AI 连接测试已取消。');
      } else {
        setErrorMessage(`AI 连接失败：${(error as Error).message}`);
        setStatusMessage('');
        setAiRetryAction('test');
      }
    } finally {
      aiAbortControllerRef.current = null;
      setIsTestingAi(false);
    }
  };

  const generateAiCandidates = async (
    forceRefresh = false,
  ): Promise<void> => {
    if (!inputText.trim() || isAiProcessing || isTestingAi) return;
    const controller = new AbortController();
    aiAbortControllerRef.current = controller;
    setIsAiProcessing(true);
    setAiProgress(null);
    setAiRetryAction(null);
    setErrorMessage('');
    setStatusMessage('AI 正在分析原文并生成候选卡...');

    try {
      const { createAiGenerationCacheKey, generateCardsWithAi } =
        await import('./ai');
      const cacheKey = await createAiGenerationCacheKey(
        inputText,
        settings.ai,
      );
      const cached =
        settings.ai.useCache && !forceRefresh
          ? await loadAiGenerationCache(cacheKey)
          : null;
      const result = cached
        ? { ...cached.result, fromCache: true }
        : await generateCardsWithAi(
            inputText,
            { ...settings.ai, apiKey },
            {
              signal: controller.signal,
              onProgress: setAiProgress,
            },
          );
      if (!cached && settings.ai.useCache) {
        await saveAiGenerationCache({
          key: cacheKey,
          result,
          createdAt: Date.now(),
        });
      }
      const existing = new Set(cards.map(cardIdentity));
      const locatedCandidates = attachSourceLocations(
        result.cards,
        pdfSourcePages,
      );
      const uniqueCandidates = locatedCandidates.filter((card) => {
        const key = cardIdentity(card);
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
      });
      setCards((current) => [...uniqueCandidates, ...current]);
      setSelectedIds(new Set());
      setCurrentStep('review');
      const tokenText =
        result.usage.promptTokens || result.usage.completionTokens
          ? `，使用 ${result.usage.promptTokens} 输入 / ${result.usage.completionTokens} 输出 tokens`
          : '';
      const retryText = result.retriedRequests
        ? `，自动重试 ${result.retriedRequests} 次`
        : '';
      const sourceText = result.fromCache ? '（来自本地缓存）' : '';
      setStatusMessage(
        `AI 生成 ${uniqueCandidates.length} 张不重复候选卡${sourceText}，跳过 ${result.skippedChunks} 个异常文本块${retryText}${tokenText}。请审核后批准。`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('已取消 AI 制卡，现有卡片未受影响。');
      } else {
        setErrorMessage(`AI 制卡失败：${(error as Error).message}`);
        setStatusMessage('');
        setAiRetryAction('generate');
      }
    } finally {
      aiAbortControllerRef.current = null;
      setAiProgress(null);
      setIsAiProcessing(false);
    }
  };

  const cancelAiProcessing = (): void => {
    aiAbortControllerRef.current?.abort();
  };

  const clearAiCache = async (): Promise<void> => {
    if (!window.confirm('确定清空本机保存的 AI 生成缓存吗？现有卡片不会删除。')) {
      return;
    }
    try {
      await clearAiGenerationCache();
      setStatusMessage('本机 AI 生成缓存已清空，现有卡片未受影响。');
      setErrorMessage('');
    } catch {
      setErrorMessage('AI 缓存清理失败，请稍后重试。');
    }
  };

  const updateCard = (
    id: string,
    field: EditableCardField,
    value: string | string[],
  ): void => {
    setLastDeletedSnapshot(null);
    setCards((current) =>
      current.map((card) =>
        card.id === id ? ({ ...card, [field]: value } as Card) : card,
      ),
    );
  };

  const openCardSource = (id: string): void => {
    const card = cards.find((candidate) => candidate.id === id);
    if (!card) return;
    if (!pdfFile) {
      setErrorMessage('当前会话没有可预览的 PDF，请重新上传原文件。');
      return;
    }
    setErrorMessage('');
    setSourceCardId(id);
    setPreviewPage(card.sourcePage ?? previewPage);
    setIsSelectingSource(false);
    setWorkspaceView('pdf');
    setCurrentStep('review');
  };

  const openPdfWorkspace = (): void => {
    if (!pdfFile) return;
    const card =
      cards.find((candidate) => candidate.id === sourceCardId) ??
      cards.find((candidate) => candidate.sourcePage) ??
      cards[0];
    setSourceCardId(card?.id ?? null);
    if (card?.sourcePage) setPreviewPage(card.sourcePage);
    setIsSelectingSource(false);
    setWorkspaceView('pdf');
    setCurrentStep('review');
  };

  const setActiveSourceCard = (id: string): void => {
    const card = cards.find((candidate) => candidate.id === id);
    if (!card) return;
    setSourceCardId(id);
    if (card.sourcePage) setPreviewPage(card.sourcePage);
    setIsSelectingSource(false);
  };

  const selectSourceRect = (rect: PdfSourceRect): void => {
    if (!sourceCardId) return;
    const sourceText = textInsideSourceRect(
      rect,
      pdfSourcePages.find((page) => page.page === previewPage)?.regions ?? [],
    );
    setCards((current) =>
      current.map((card) =>
        card.id === sourceCardId
          ? {
              ...card,
              sourcePage: previewPage,
              sourceRects: [rect],
              sourceQuote: sourceText || card.sourceQuote,
            }
          : card,
      ),
    );
    setIsSelectingSource(false);
    setStatusMessage(
      sourceText
        ? `框选已保存：已关联 PDF 第 ${previewPage} 页内的 OCR 原文。`
        : `框选已保存：已将该区域设为 PDF 第 ${previewPage} 页的原文依据。`,
    );
  };

  const toggleSourceSelection = (): void => {
    const next = !isSelectingSource;
    setIsSelectingSource(next);
    setStatusMessage(
      next
        ? '框选模式已开启：在 PDF 上按住拖动，松开后自动保存。'
        : '已取消框选。',
    );
  };

  const replaceAnswerWithSourceQuote = (): void => {
    const card = cards.find((candidate) => candidate.id === sourceCardId);
    if (!card?.sourceQuote) return;
    updateCard(card.id, 'answer', card.sourceQuote);
    setStatusMessage('已用当前框选的原文替换答案。');
  };

  const clearSourceRects = (): void => {
    if (!sourceCardId) return;
    setCards((current) =>
      current.map((card) =>
        card.id === sourceCardId
          ? { ...card, sourceRects: undefined }
          : card,
      ),
    );
    setIsSelectingSource(false);
    setStatusMessage('已清除当前卡片的精确定位，可重新框选原文。');
  };

  const deleteCards = (ids: Set<string>): void => {
    if (!ids.size) return;
    setLastDeletedSnapshot(cards);
    setCards((current) => current.filter((card) => !ids.has(card.id)));
    if (sourceCardId && ids.has(sourceCardId)) setSourceCardId(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    setStatusMessage(`已删除 ${ids.size} 张卡片，可立即撤销。`);
  };

  const undoDelete = (): void => {
    if (!lastDeletedSnapshot) return;
    setCards(lastDeletedSnapshot);
    setLastDeletedSnapshot(null);
    setStatusMessage('已撤销删除。');
  };

  const approveCard = (id: string): void => {
    const blocking = qualitySummary.reports[id]?.blockingIssues ?? [];
    if (blocking.length) {
      setReviewFilter('quality');
      setErrorMessage(`暂不能批准：${blocking[0].message}`);
      return;
    }
    setCards((current) =>
      current.map((card) =>
        card.id === id ? { ...card, reviewStatus: 'approved' } : card,
      ),
    );
    setErrorMessage('');
    setStatusMessage('AI 候选卡已批准，可随其他卡片一起导出。');
  };

  const approveSelected = (): void => {
    if (!selectedIds.size) return;
    const safeIds = new Set(
      cards
        .filter(
          (card) =>
            selectedIds.has(card.id) &&
            card.reviewStatus === 'pending' &&
            !qualitySummary.reports[card.id]?.blockingIssues.length,
        )
        .map((card) => card.id),
    );
    const blockedCount = selectedPendingCount - safeIds.size;
    if (!safeIds.size) {
      setReviewFilter('quality');
      setErrorMessage('所选待审核卡均有阻塞问题，请先修正问题或来源依据。');
      return;
    }
    setCards((current) =>
      current.map((card) =>
        safeIds.has(card.id)
          ? { ...card, reviewStatus: 'approved' }
          : card,
      ),
    );
    setErrorMessage('');
    setStatusMessage(
      `已安全批准 ${safeIds.size} 张卡片${blockedCount ? `，另有 ${blockedCount} 张因质量问题跳过` : ''}。`,
    );
  };

  const approveAllReadyAiCards = (): void => {
    const readyIds = new Set(qualitySummary.approvablePendingIds);
    if (!readyIds.size) return;
    setCards((current) =>
      current.map((card) =>
        readyIds.has(card.id)
          ? { ...card, reviewStatus: 'approved' }
          : card,
      ),
    );
    setErrorMessage('');
    setStatusMessage(`已批准 ${readyIds.size} 张无阻塞问题的 AI 候选卡。`);
  };

  const toggleCard = (id: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllCards = (): void => {
    setSelectedIds((current) =>
      current.size === cards.length
        ? new Set()
        : new Set(cards.map((card) => card.id)),
    );
  };

  const toggleVisibleCards = (): void => {
    const visibleIds = new Set(visibleCards.map((card) => card.id));
    const allVisibleSelected =
      visibleIds.size > 0 &&
      [...visibleIds].every((id) => selectedIds.has(id));
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleIds.forEach((id) => {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  };

  const applyBulkTag = (): void => {
    const tag = bulkTag.trim();
    if (!tag || !selectedIds.size) return;
    setLastDeletedSnapshot(null);
    setCards((current) =>
      current.map((card) =>
        selectedIds.has(card.id)
          ? { ...card, tags: [...new Set([...card.tags, tag])] }
          : card,
      ),
    );
    setBulkTag('');
    setStatusMessage(`已为 ${selectedIds.size} 张卡片添加标签“${tag}”。`);
  };

  const applyBulkType = (): void => {
    if (!bulkType.trim() || !selectedIds.size) return;
    setLastDeletedSnapshot(null);
    setCards((current) =>
      current.map((card) =>
        selectedIds.has(card.id) ? { ...card, type: bulkType.trim() } : card,
      ),
    );
    setStatusMessage(`已批量修改 ${selectedIds.size} 张卡片类型。`);
  };

  const addBlankCard = (): void => {
    const card = createCard({
      question: '',
      options: '',
      answer: '',
      point: '',
      analysis: '',
      type: settings.parseMode === 'exam' ? '选择题' : '简答题',
      chapter: '',
      tags: ['手动添加'],
      origin: 'manual',
    });
    setLastDeletedSnapshot(null);
    setCards((current) => [card, ...current]);
    setSourceCardId(card.id);
    setCurrentStep('review');
    setStatusMessage('已添加空白卡片，请在预览区编辑。');
  };

  const exportText = (): void => {
    if (!exportableCards.length) return;
    downloadBlob(
      new Blob([buildAnkiText(exportableCards)], {
        type: 'text/plain;charset=utf-8',
      }),
      exportFileName(settings.deckName, exportableCards.length, 'txt'),
    );
  };

  const exportJson = (): void => {
    if (!exportableCards.length) return;
    downloadBlob(
      new Blob([buildCardsJson(exportableCards)], {
        type: 'application/json;charset=utf-8',
      }),
      exportFileName(settings.deckName, exportableCards.length, 'json'),
    );
  };

  const exportPackage = async (): Promise<void> => {
    if (!exportableCards.length || isExportingPackage) return;
    setIsExportingPackage(true);
    setErrorMessage('');
    setStatusMessage('正在生成 Anki .apkg 包...');
    try {
      const blob = await buildAnkiPackage(exportableCards, settings.deckName);
      downloadBlob(
        blob,
        exportFileName(settings.deckName, exportableCards.length, 'apkg'),
      );
      setStatusMessage(
        `已生成包含 ${exportableCards.length} 张已审核卡片的 .apkg。`,
      );
    } catch (error) {
      setErrorMessage(`Anki 包生成失败：${(error as Error).message}`);
      setStatusMessage('');
    } finally {
      setIsExportingPackage(false);
    }
  };

  const exportWorkspace = (): void => {
    const content = buildWorkspaceBackup(
      inputText,
      cards,
      settings,
      pdfSourcePages,
    );
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(
      new Blob([content], { type: 'application/json;charset=utf-8' }),
      `Anki工作区_${date}.json`,
    );
    setStatusMessage(
      `工作区备份已导出：${cards.length} 张卡片、${pdfSourcePages.length} 页提取文本。`,
    );
    setErrorMessage('');
  };

  const importWorkspace = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) {
        throw new Error('备份文件超过 20 MB，请确认选择的是工作区 JSON。');
      }
      const backup = parseWorkspaceBackup(await file.text());
      if (
        (cards.length || inputText.trim()) &&
        !window.confirm(
          `恢复备份将替换当前工作区。备份包含 ${backup.cards.length} 张卡片，是否继续？`,
        )
      ) {
        return;
      }
      abortControllerRef.current?.abort();
      aiAbortControllerRef.current?.abort();
      setInputText(backup.inputText);
      setCards(backup.cards);
      setSettings(normalizeDraftSettings(backup.settings));
      setPdfSourcePages(backup.pdfSourcePages);
      setPdfFile(null);
      setImportedFileNames([]);
      setSelectedIds(new Set());
      setLastDeletedSnapshot(null);
      setSourceCardId(backup.cards[0]?.id ?? null);
      setPreviewPage(backup.pdfSourcePages[0]?.page ?? 1);
      setWorkspaceView('cards');
      setReviewFilter('all');
      setReviewQuery('');
      setReviewSort('original');
      setCurrentStep(
        backup.cards.length
          ? 'review'
          : backup.inputText.trim()
            ? 'generate'
            : 'import',
      );
      setErrorMessage('');
      setStatusMessage(
        `已恢复 ${backup.cards.length} 张卡片和 ${backup.pdfSourcePages.length} 页提取文本。PDF 原文件需重新选择后才能对照。`,
      );
    } catch (error) {
      setErrorMessage(`工作区恢复失败：${(error as Error).message}`);
      setStatusMessage('');
    } finally {
      if (workspaceInputRef.current) workspaceInputRef.current.value = '';
    }
  };

  const resetWorkspace = async (): Promise<void> => {
    if (
      (cards.length || inputText) &&
      !window.confirm('确定清空当前卡片、文本和本地草稿吗？')
    ) {
      return;
    }
    aiAbortControllerRef.current?.abort();
    await clearDraft();
    setCards([]);
    setInputText('');
    setSettings(DEFAULT_SETTINGS);
    setSelectedIds(new Set());
    setLastDeletedSnapshot(null);
    setApiKey('');
    setPdfFile(null);
    setImportedFileNames([]);
    setIsDraggingFiles(false);
    setPdfSourcePages([]);
    setWorkspaceView('cards');
    setSourceCardId(null);
    setPreviewPage(1);
    setIsSelectingSource(false);
    setAiProgress(null);
    setAiConnection(null);
    setAiRetryAction(null);
    setCurrentStep('import');
    setReviewFilter('all');
    setReviewQuery('');
    setReviewSort('original');
    setIsModelCenterOpen(false);
    setErrorMessage('');
    setStatusMessage('工作区已清空。');
  };

  const selectTemplate = (id: string): void => {
    const template =
      id === GENERAL_PARSER_TEMPLATE.id
        ? GENERAL_PARSER_TEMPLATE
        : DEFAULT_PARSER_TEMPLATE;
    updateSetting('parserTemplate', cloneTemplate(template));
  };

  const templateError = validateParserTemplate(settings.parserTemplate);
  const qualitySummary = evaluateCardQuality(cards);
  const exportableCards = qualitySummary.exportableCards;
  const approvedCount = cards.filter(
    (card) => card.reviewStatus === 'approved',
  ).length;
  const pendingCount = cards.length - approvedCount;
  const blockingQualityCount = qualitySummary.blockingCardIds.length;
  const qualityIssueCount = qualitySummary.issueCardIds.length;
  const selectedCount = selectedIds.size;
  const selectedPendingCount = cards.filter(
    (card) =>
      selectedIds.has(card.id) && card.reviewStatus === 'pending',
  ).length;
  const allSelected = cards.length > 0 && selectedCount === cards.length;
  const sourceCard =
    cards.find((card) => card.id === sourceCardId) ?? cards[0] ?? null;
  const cardsOnPreviewPage = cards.filter(
    (card) => card.sourcePage === previewPage,
  );
  const sourceReady = Boolean(inputText.trim());
  const sourceReviewCount = cards.filter(
    (card) =>
      card.tags.includes('来源待核') ||
      (card.origin === 'ai' && !card.sourceQuote),
  ).length;
  const normalizedReviewQuery = reviewQuery.trim().toLocaleLowerCase();
  const visibleCards = cards.filter((card) => {
    if (reviewFilter === 'pending') return card.reviewStatus === 'pending';
    if (reviewFilter === 'approved') return card.reviewStatus === 'approved';
    if (reviewFilter === 'source') {
      return (
        card.tags.includes('来源待核') ||
        (card.origin === 'ai' && !card.sourceQuote)
      );
    }
    if (reviewFilter === 'quality') {
      return qualitySummary.issueCardIds.includes(card.id);
    }
    return true;
  }).filter((card) => {
    if (!normalizedReviewQuery) return true;
    return [
      card.question,
      card.answer,
      card.point,
      card.analysis,
      card.chapter,
      card.type,
      card.tags.join(' '),
      card.sourceQuote ?? '',
    ]
      .join('\n')
      .toLocaleLowerCase()
      .includes(normalizedReviewQuery);
  }).sort((left, right) => {
    if (reviewSort === 'source') {
      return (
        (left.sourcePage ?? Number.MAX_SAFE_INTEGER) -
          (right.sourcePage ?? Number.MAX_SAFE_INTEGER) ||
        cards.indexOf(left) - cards.indexOf(right)
      );
    }
    if (reviewSort === 'quality') {
      const leftReport = qualitySummary.reports[left.id];
      const rightReport = qualitySummary.reports[right.id];
      return (
        rightReport.blockingIssues.length - leftReport.blockingIssues.length ||
        rightReport.warningIssues.length - leftReport.warningIssues.length ||
        cards.indexOf(left) - cards.indexOf(right)
      );
    }
    if (reviewSort === 'type') {
      return (
        left.type.localeCompare(right.type, 'zh-CN') ||
        cards.indexOf(left) - cards.indexOf(right)
      );
    }
    return cards.indexOf(left) - cards.indexOf(right);
  });
  const visibleSelectedCount = visibleCards.filter((card) =>
    selectedIds.has(card.id),
  ).length;
  const allVisibleSelected =
    visibleCards.length > 0 && visibleSelectedCount === visibleCards.length;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <a
        href="#workflow-content"
        className="sr-only fixed left-3 top-3 z-[70] rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white focus:not-sr-only"
      >
        跳到主要工作区
      </a>
      <div
        id="workflow-content"
        tabIndex={-1}
        className="mx-auto max-w-[1380px] space-y-3 p-3 sm:p-4"
      >
        <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                <ScanText size={14} /> PDF · OCR · Anki
              </span>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                {draftReady ? '草稿已自动保存' : '正在恢复草稿'}
              </span>
            </div>
            <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">
              Anki 制卡工作台
            </h1>
            <p className="mt-1 truncate text-sm text-slate-500">
              {importedFileNames.length
                ? `当前来源：${importedFileNames.slice(0, 2).join('、')}${importedFileNames.length > 2 ? ` 等 ${importedFileNames.length} 个文件` : ''}`
                : sourceReady
                  ? '当前来源：文本内容'
                  : '导入资料后，按步骤完成生成、审核和导出。'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={workspaceInputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="选择工作区备份"
              onChange={(event) => void importWorkspace(event)}
            />
            <div className="hidden rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-right sm:block">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                当前模型
              </p>
              <p className="max-w-48 truncate text-sm font-semibold text-slate-700">
                {settings.ai.model || '尚未配置'}
              </p>
            </div>
            <button
              type="button"
              onClick={exportWorkspace}
              disabled={!cards.length && !inputText.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              <FileJson size={16} /> 备份
            </button>
            <button
              type="button"
              onClick={() => workspaceInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <RotateCcw size={16} /> 恢复
            </button>
            <button
              type="button"
              onClick={() => setIsModelCenterOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-700 transition hover:bg-violet-100"
            >
              <Bot size={17} /> 模型中心
            </button>
            <button
              type="button"
              onClick={() => void resetWorkspace()}
              className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            >
              清空工作区
            </button>
          </div>
        </header>

        <WorkflowStepper
          currentStep={currentStep}
          onChange={setCurrentStep}
          sourceReady={sourceReady}
          cardCount={cards.length}
          exportableCount={exportableCards.length}
        />

        {currentStep === 'import' && (
          <main className="grid gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex border-b border-slate-100 p-2">
                <button
                  type="button"
                  aria-pressed={settings.activeTab === 'upload'}
                  onClick={() => updateSetting('activeTab', 'upload')}
                  className={
                    'flex-1 rounded-xl py-2.5 text-sm font-bold transition ' +
                    (settings.activeTab === 'upload'
                      ? 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200'
                      : 'text-slate-500 hover:bg-slate-100')
                  }
                >
                  文件导入
                </button>
                <button
                  type="button"
                  aria-pressed={settings.activeTab === 'text'}
                  onClick={() => updateSetting('activeTab', 'text')}
                  className={
                    'flex-1 rounded-xl py-2.5 text-sm font-bold transition ' +
                    (settings.activeTab === 'text'
                      ? 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200'
                      : 'text-slate-500 hover:bg-slate-100')
                  }
                >
                  文本粘贴
                </button>
              </div>

              <div className="space-y-4 p-4 sm:p-5">
                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                    资料用途
                  </p>
                  <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => updateSetting('parseMode', 'textbook')}
                      className={
                        'rounded-xl py-2.5 text-sm font-bold transition ' +
                        (settings.parseMode === 'textbook'
                          ? 'bg-white text-slate-950 shadow-sm'
                          : 'text-slate-500')
                      }
                    >
                      教材背诵卡
                    </button>
                    <button
                      type="button"
                      onClick={() => updateSetting('parseMode', 'exam')}
                      className={
                        'rounded-xl py-2.5 text-sm font-bold transition ' +
                        (settings.parseMode === 'exam'
                          ? 'bg-white text-slate-950 shadow-sm'
                          : 'text-slate-500')
                      }
                    >
                      题库解析卡
                    </button>
                  </div>
                </div>

                {settings.activeTab === 'upload' ? (
                  <div className="space-y-4">
                    <input
                      id="pdf-upload"
                      type="file"
                      accept={SUPPORTED_FILE_ACCEPT}
                      multiple
                      className="sr-only"
                      ref={fileInputRef}
                      disabled={isProcessing}
                      aria-label="选择资料文件"
                      onChange={(event) => void handleFileUpload(event)}
                    />
                    <label
                      htmlFor="pdf-upload"
                      aria-disabled={isProcessing}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        if (!isProcessing) setIsDraggingFiles(true);
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                          setIsDraggingFiles(false);
                        }
                      }}
                      onDrop={handleFileDrop}
                      className={
                        'flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-5 text-center transition ' +
                        (isProcessing
                          ? 'cursor-wait border-violet-300 bg-violet-50'
                          : isDraggingFiles
                            ? 'cursor-copy border-violet-400 bg-violet-50 ring-2 ring-violet-100'
                            : 'cursor-pointer border-slate-300 bg-slate-50 hover:border-violet-300 hover:bg-violet-50/50')
                      }
                    >
                      {isProcessing ? (
                        <RefreshCw className="mb-3 h-9 w-9 animate-spin text-violet-500" />
                      ) : (
                        <UploadCloud className="mb-3 h-9 w-9 text-violet-400" />
                      )}
                      <p className="font-bold text-slate-800">
                        {isProcessing
                          ? progressText(pdfProgress)
                          : isDraggingFiles
                            ? '松开即可导入'
                            : '拖入文件，或点击选择'}
                      </p>
                      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-500">
                        支持多选：PDF、Word、TXT、Markdown、CSV、TSV、JSON、HTML
                      </p>
                    </label>

                    {isProcessing && (
                      <button
                        type="button"
                        onClick={cancelProcessing}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-bold text-red-600 hover:bg-red-100"
                      >
                        <XCircle size={17} /> 取消处理
                      </button>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <label className="space-y-1 text-xs font-semibold text-slate-500">
                        起始页
                        <input
                          type="number"
                          min="1"
                          value={settings.pageStart}
                          onChange={(event) =>
                            updateSetting('pageStart', event.target.value)
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-500">
                        结束页
                        <input
                          type="number"
                          min="1"
                          value={settings.pageEnd}
                          onChange={(event) =>
                            updateSetting('pageEnd', event.target.value)
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="col-span-2 space-y-1 text-xs font-semibold text-slate-500">
                        识别方式
                        <select
                          value={settings.extractMode}
                          onChange={(event) =>
                            updateSetting(
                              'extractMode',
                              event.target.value as AppSettings['extractMode'],
                            )
                          }
                          className={inputClass}
                        >
                          <option value="auto">自动判断</option>
                          <option value="ocr">强制 OCR</option>
                          <option value="text">仅文本层</option>
                        </select>
                      </label>
                    </div>

                    <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <summary className="cursor-pointer text-sm font-bold text-slate-600">
                        PDF 高级设置
                      </summary>
                      <label className="mt-4 block space-y-1 text-xs font-semibold text-slate-500">
                        OCR 清晰度
                        <input
                          type="number"
                          min="1"
                          max="3"
                          step="0.1"
                          value={settings.ocrScale}
                          onChange={(event) =>
                            updateSetting('ocrScale', event.target.value)
                          }
                          className={inputClass}
                        />
                      </label>
                    </details>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <textarea
                      value={inputText}
                      onChange={(event) => {
                        setInputText(event.target.value);
                        setImportedFileNames([]);
                        setPdfFile(null);
                        setPdfSourcePages([]);
                      }}
                      className="min-h-64 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed outline-none focus:border-transparent focus:ring-2 focus:ring-violet-500"
                      placeholder={
                        settings.parseMode === 'textbook'
                          ? '粘贴教材正文，系统会生成名词解释、简答和填空卡...'
                          : '粘贴包含题干、选项、答案和解析的题库文本...'
                      }
                    />
                    <button
                      type="button"
                      onClick={processPastedText}
                      disabled={!inputText.trim() || isProcessing}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <BookOpen size={18} /> 开始制卡
                    </button>
                  </div>
                )}
              </div>
            </section>

            <section className="flex min-h-[520px] flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              {sourceReady ? (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                        资料已就绪
                      </span>
                      <h2 className="mt-3 text-xl font-bold text-slate-950">
                        {importedFileNames.length
                          ? importedFileNames.length === 1
                            ? importedFileNames[0]
                            : `${importedFileNames.length} 个文件`
                          : '粘贴文本'}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        可以继续调整生成策略，或直接使用当前规则制卡。
                      </p>
                    </div>
                    <FileText className="h-10 w-10 text-slate-200" />
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs text-slate-400">字符数</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">
                        {inputText.length.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs text-slate-400">已提取页</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">
                        {pdfSourcePages.length || '—'}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs text-slate-400">OCR 页</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">
                        {pdfSourcePages.filter((page) => page.method === 'ocr').length}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs text-slate-400">现有卡片</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">
                        {cards.length}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                      原文预览
                    </p>
                    <p className="line-clamp-[12] whitespace-pre-line text-sm leading-7 text-slate-600">
                      {inputText.slice(0, 2200)}
                    </p>
                  </div>

                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setCurrentStep('generate')}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      调整生成设置
                    </button>
                    <button
                      type="button"
                      onClick={processPastedText}
                      disabled={isProcessing}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:bg-slate-300"
                    >
                      直接生成卡片 <ArrowRight size={16} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCurrentStep('generate');
                      setIsModelCenterOpen(true);
                    }}
                    className="mt-2 w-full rounded-xl px-4 py-2.5 text-sm font-bold text-violet-700 transition hover:bg-violet-50"
                  >
                    AI 辅助生成候选卡
                  </button>
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
                  <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-50 text-violet-600">
                    <ScanText size={34} />
                  </div>
                  <h2 className="mt-5 text-xl font-bold text-slate-950">
                    从一份资料开始
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
                    上传 PDF 或粘贴文本。资料、卡片和设置会自动保存到当前浏览器草稿。
                  </p>
                  <div className="mt-6 grid w-full max-w-lg gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="font-bold text-slate-800">1. 导入</p>
                      <p className="mt-1 text-xs text-slate-400">PDF 或文本</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="font-bold text-slate-800">2. 生成</p>
                      <p className="mt-1 text-xs text-slate-400">本地或 AI</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <p className="font-bold text-slate-800">3. 审核</p>
                      <p className="mt-1 text-xs text-slate-400">批准后导出</p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </main>
        )}

        {currentStep === 'generate' && (
          <main className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  当前资料
                </p>
                <h2 className="mt-2 truncate font-bold text-slate-950">
                  {importedFileNames.length
                    ? importedFileNames.length === 1
                      ? importedFileNames[0]
                      : `${importedFileNames.length} 个文件`
                    : '粘贴文本'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {inputText.length.toLocaleString()} 字符
                  {pdfSourcePages.length
                    ? ' · ' + pdfSourcePages.length + ' 页'
                    : ''}
                </p>
                <button
                  type="button"
                  onClick={() => setCurrentStep('import')}
                  className="mt-4 text-sm font-bold text-blue-700 hover:underline"
                >
                  返回修改资料
                </button>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="font-bold text-slate-900">制卡策略</h3>
                <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => updateSetting('parseMode', 'textbook')}
                    className={
                      'rounded-xl py-2 text-sm font-bold ' +
                      (settings.parseMode === 'textbook'
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-slate-500')
                    }
                  >
                    教材背诵卡
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSetting('parseMode', 'exam')}
                    className={
                      'rounded-xl py-2 text-sm font-bold ' +
                      (settings.parseMode === 'exam'
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-slate-500')
                    }
                  >
                    题库解析卡
                  </button>
                </div>

                {settings.parseMode === 'textbook' ? (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-xs font-semibold text-slate-500">
                      每页最多卡片
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={settings.maxCardsPerPage}
                        onChange={(event) =>
                          updateSetting('maxCardsPerPage', event.target.value)
                        }
                        className={inputClass}
                      />
                    </label>
                    <label className="space-y-1 text-xs font-semibold text-slate-500">
                      答案最长字数
                      <input
                        type="number"
                        min="60"
                        max="1000"
                        value={settings.maxAnswerLength}
                        onChange={(event) =>
                          updateSetting('maxAnswerLength', event.target.value)
                        }
                        className={inputClass}
                      />
                    </label>
                  </div>
                ) : (
                  <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-slate-700">
                      <Settings2 size={16} /> 题库解析模板
                    </summary>
                    <div className="mt-4 space-y-3">
                      <label className="space-y-1 text-xs font-semibold text-slate-500">
                        预设
                        <select
                          value={
                            settings.parserTemplate.id === GENERAL_PARSER_TEMPLATE.id
                              ? GENERAL_PARSER_TEMPLATE.id
                              : settings.parserTemplate.id === DEFAULT_PARSER_TEMPLATE.id
                                ? DEFAULT_PARSER_TEMPLATE.id
                                : 'custom'
                          }
                          onChange={(event) => {
                            if (event.target.value !== 'custom') {
                              selectTemplate(event.target.value);
                            }
                          }}
                          className={inputClass}
                        >
                          <option value={DEFAULT_PARSER_TEMPLATE.id}>刑法母子题</option>
                          <option value={GENERAL_PARSER_TEMPLATE.id}>通用选择题</option>
                          <option value="custom">自定义</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-semibold text-slate-500">
                        题号正则
                        <textarea
                          value={settings.parserTemplate.questionPattern}
                          onChange={(event) =>
                            updateTemplate('questionPattern', event.target.value)
                          }
                          className={inputClass + ' min-h-20 font-mono'}
                        />
                      </label>
                      {(
                        [
                          ['answerLabels', '答案标签'],
                          ['pointLabels', '考点标签'],
                          ['analysisLabels', '解析标签'],
                          ['trailingLabels', '截断标签'],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key} className="space-y-1 text-xs font-semibold text-slate-500">
                          {label}（逗号分隔）
                          <input
                            value={settings.parserTemplate[key].join(', ')}
                            onChange={(event) =>
                              updateTemplate(key, splitLabels(event.target.value))
                            }
                            className={inputClass}
                          />
                        </label>
                      ))}
                      {templateError && (
                        <p className="text-xs text-red-600">{templateError}</p>
                      )}
                    </div>
                  </details>
                )}
              </section>
            </aside>

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-blue-600">
                    第 2 步
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-slate-950">
                    选择生成方式
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    可以组合使用本地规则、AI 候选和手动卡片。
                  </p>
                </div>
                {cards.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCurrentStep('review')}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
                  >
                    去审核 {cards.length} 张卡片 <ArrowRight size={16} />
                  </button>
                )}
              </div>

              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                <article className="flex min-h-60 flex-col rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-600 text-white">
                    <BookOpen size={20} />
                  </div>
                  <h3 className="mt-4 font-bold text-slate-950">本地规则生成</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
                    适合结构清楚的教材或题库，不调用外部接口，不产生模型费用。
                  </p>
                  <button
                    type="button"
                    onClick={processPastedText}
                    disabled={!sourceReady || isProcessing}
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:bg-slate-300"
                  >
                    <RefreshCw size={16} />
                    {cards.length || pdfSourcePages.length
                      ? '重新生成本地卡片'
                      : '使用本地规则生成'}
                  </button>
                </article>

                <article className="flex min-h-60 flex-col rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-600 text-white">
                    <Sparkles size={20} />
                  </div>
                  <h3 className="mt-4 font-bold text-slate-950">AI 辅助生成候选卡</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    当前模型：{settings.ai.model || '尚未配置'}。结果默认进入待审核队列。
                  </p>
                  <label className="mt-4 block flex-1 space-y-1 text-xs font-semibold text-slate-500">
                    补充制卡要求
                    <textarea
                      value={settings.ai.customInstructions}
                      onChange={(event) =>
                        updateAiSetting('customInstructions', event.target.value)
                      }
                      placeholder="例如：优先生成罪名辨析卡；答案不超过 100 字。"
                      className={inputClass + ' min-h-24 resize-y'}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsModelCenterOpen(true)}
                    className="mt-3 text-sm font-bold text-violet-700 hover:underline"
                  >
                    配置或测试模型
                  </button>
                  {isAiProcessing ? (
                    <button
                      type="button"
                      onClick={cancelAiProcessing}
                      className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-600"
                    >
                      <XCircle size={16} /> 取消 AI
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void generateAiCandidates(false)}
                      disabled={!sourceReady || !settings.ai.model.trim() || isTestingAi}
                      className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:bg-slate-300"
                    >
                      <Sparkles size={16} /> 生成候选卡
                    </button>
                  )}
                  {!isAiProcessing && settings.ai.useCache && (
                    <button
                      type="button"
                      onClick={() => void generateAiCandidates(true)}
                      disabled={!sourceReady || !settings.ai.model.trim() || isTestingAi}
                      className="mt-2 text-xs font-semibold text-slate-500 hover:text-violet-700 disabled:opacity-40"
                    >
                      忽略缓存，重新请求模型
                    </button>
                  )}
                  {aiProgress && (
                    <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-violet-700">
                      <p>
                        {aiProgress.detail}（{aiProgress.completed}/{aiProgress.total}）
                      </p>
                      {aiProgress.stage === 'retrying' && (
                        <p className="mt-1 text-amber-700">
                          请求 {aiProgress.attempt}/{aiProgress.maxAttempts}，只会重试临时故障。
                        </p>
                      )}
                    </div>
                  )}
                </article>

                <article className="flex min-h-60 flex-col rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-blue-100 text-blue-700">
                    <Plus size={20} />
                  </div>
                  <h3 className="mt-4 font-bold text-slate-950">手动添加卡片</h3>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
                    适合补充重点、修正遗漏，或从零创建一张完全可编辑的卡片。
                  </p>
                  <button
                    type="button"
                    onClick={addBlankCard}
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2.5 text-sm font-bold text-white hover:bg-violet-700"
                  >
                    <Plus size={16} /> 添加卡片
                  </button>
                </article>
              </div>
            </section>
          </main>
        )}

        {currentStep === 'review' && (
          <main className="flex min-h-[680px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-4 border-b border-slate-100 bg-slate-50/80 p-4 sm:p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-600">
                    第 3 步
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-slate-950">
                    {workspaceView === 'pdf' ? 'PDF 对照校订' : '审核与精修'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    AI 卡必须批准后才能进入正式导出。
                  </p>
                  <p className="mt-2 text-sm font-bold text-slate-700">
                    共 {cards.length} 张
                    {pendingCount > 0 ? ` · 待审核 ${pendingCount}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-xl border border-slate-200 bg-white p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setWorkspaceView('cards');
                        setIsSelectingSource(false);
                      }}
                      className={
                        'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ' +
                        (workspaceView === 'cards'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100')
                      }
                    >
                      <List size={14} /> 卡片
                    </button>
                    <button
                      type="button"
                      onClick={openPdfWorkspace}
                      disabled={!pdfFile}
                      className={
                        'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ' +
                        (workspaceView === 'pdf'
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100')
                      }
                      title={pdfFile ? '打开 ' + pdfFile.name : '上传 PDF 后可使用对照阅读'}
                    >
                      <MapPin size={14} /> PDF 对照
                    </button>
                  </div>
                  <button type="button" onClick={addBlankCard} className={buttonSecondary}>
                    <Plus size={16} /> 添加卡片
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentStep('export')}
                    disabled={!exportableCards.length}
                    title={
                      exportableCards.length
                        ? '进入导出检查'
                        : '至少批准一张卡片后才能导出'
                    }
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    去导出 <ArrowRight size={16} />
                  </button>
                </div>
              </div>

              {workspaceView === 'cards' && (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <button
                      type="button"
                      onClick={() => setReviewFilter('all')}
                      className={
                        'rounded-xl border px-3 py-2 text-left transition ' +
                        (reviewFilter === 'all'
                          ? 'border-violet-300 bg-violet-50 text-violet-800 ring-1 ring-violet-100'
                          : 'border-slate-200 bg-white text-slate-600')
                      }
                    >
                      <span className="block text-xs opacity-70">全部卡片</span>
                      <span className="mt-0.5 block text-lg font-bold">{cards.length}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewFilter('pending')}
                      className={
                        'rounded-xl border px-3 py-2 text-left transition ' +
                        (reviewFilter === 'pending'
                          ? 'border-amber-300 bg-amber-50 text-amber-800 ring-1 ring-amber-100'
                          : 'border-amber-200 bg-amber-50 text-amber-700')
                      }
                    >
                      <span className="block text-xs opacity-80">待审核</span>
                      <span className="mt-0.5 block text-lg font-bold">{pendingCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewFilter('approved')}
                      className={
                        'rounded-xl border px-3 py-2 text-left transition ' +
                        (reviewFilter === 'approved'
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700')
                      }
                    >
                      <span className="block text-xs opacity-80">已批准</span>
                      <span className="mt-0.5 block text-lg font-bold">{approvedCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewFilter('source')}
                      className={
                        'rounded-xl border px-3 py-2 text-left transition ' +
                        (reviewFilter === 'source'
                          ? 'border-violet-300 bg-violet-50 text-violet-800 ring-1 ring-violet-100'
                          : 'border-blue-200 bg-blue-50 text-blue-700')
                      }
                    >
                      <span className="block text-xs opacity-80">来源待核</span>
                      <span className="mt-0.5 block text-lg font-bold">{sourceReviewCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReviewFilter('quality')}
                      className={
                        'rounded-xl border px-3 py-2 text-left transition ' +
                        (reviewFilter === 'quality'
                          ? 'border-red-300 bg-red-50 text-red-800 ring-1 ring-red-100'
                          : 'border-red-200 bg-red-50 text-red-700')
                      }
                    >
                      <span className="block text-xs opacity-80">质量问题</span>
                      <span className="mt-0.5 block text-lg font-bold">{qualityIssueCount}</span>
                    </button>
                  </div>

                  <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                      <span className="font-semibold text-red-700">
                        阻塞导出 {blockingQualityCount} 张
                      </span>
                      <span className="font-semibold text-amber-700">
                        建议复核 {qualitySummary.warningCardIds.length} 张
                      </span>
                      <span className="font-semibold text-emerald-700">
                        可安全批准 {qualitySummary.approvablePendingIds.length} 张
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {qualityIssueCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setReviewFilter('quality')}
                          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100"
                        >
                          只看质量问题
                        </button>
                      )}
                      {qualitySummary.approvablePendingIds.length > 0 && (
                        <button
                          type="button"
                          onClick={approveAllReadyAiCards}
                          className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                        >
                          批准全部合格候选
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[minmax(240px,1fr)_220px_auto] md:items-center">
                    <label className="relative">
                      <Search
                        size={16}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      />
                      <input
                        value={reviewQuery}
                        onChange={(event) => setReviewQuery(event.target.value)}
                        placeholder="搜索问题、答案、标签、章节或原文"
                        aria-label="搜索卡片"
                        className={inputClass + ' pl-9'}
                      />
                    </label>
                    <select
                      value={reviewSort}
                      onChange={(event) =>
                        setReviewSort(
                          event.target.value as typeof reviewSort,
                        )
                      }
                      aria-label="卡片排序"
                      className={inputClass}
                    >
                      <option value="original">按原始顺序</option>
                      <option value="source">按来源页码</option>
                      <option value="quality">质量问题优先</option>
                      <option value="type">按卡片类型</option>
                    </select>
                    <span className="text-xs font-semibold text-slate-500 md:text-right">
                      显示 {visibleCards.length} / {cards.length} 张
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={toggleVisibleCards} className={buttonSecondary}>
                      {allVisibleSelected ? '取消当前选择' : '选择当前结果'}
                    </button>
                    <button type="button" onClick={toggleAllCards} className={buttonSecondary}>
                      {allSelected ? '取消全部选择' : '选择全部卡片'}
                    </button>
                    {selectedCount > 0 && (
                      <>
                        <span className="text-sm font-bold text-blue-700">
                          已选 {selectedCount} 张
                        </span>
                        {selectedPendingCount > 0 && (
                          <button
                            type="button"
                            onClick={approveSelected}
                            className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-bold text-amber-700 hover:bg-amber-100"
                          >
                            <CheckCircle size={16} /> 批准所选
                          </button>
                        )}
                        <div className="flex min-w-52 flex-1 items-center gap-2">
                          <input
                            value={bulkTag}
                            onChange={(event) => setBulkTag(event.target.value)}
                            placeholder="批量添加标签"
                            className={inputClass}
                          />
                          <button
                            type="button"
                            onClick={applyBulkTag}
                            disabled={!bulkTag.trim()}
                            className={buttonSecondary}
                          >
                            <Tags size={16} /> 添加
                          </button>
                        </div>
                        <select
                          value={bulkType}
                          onChange={(event) => setBulkType(event.target.value)}
                          className={inputClass + ' w-auto'}
                        >
                          <option>选择题</option>
                          <option>名词解释</option>
                          <option>简答题</option>
                          <option>填空题</option>
                        </select>
                        <button type="button" onClick={applyBulkType} className={buttonSecondary}>
                          批量改类型
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteCards(selectedIds)}
                          className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-bold text-red-600 hover:bg-red-100"
                        >
                          <Trash2 size={16} /> 删除所选
                        </button>
                      </>
                    )}
                  </div>

                  {lastDeletedSnapshot && (
                    <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <span>卡片已删除。</span>
                      <button
                        type="button"
                        onClick={undoDelete}
                        className="inline-flex items-center gap-1 font-bold hover:underline"
                      >
                        <RotateCcw size={15} /> 撤销删除
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {workspaceView === 'cards' ? (
              <div className="flex-1 overflow-y-auto bg-slate-100/60 p-3 sm:p-5">
                {visibleCards.length ? (
                  <div className="space-y-4">
                    {visibleCards.map((card) => (
                      <CardEditor
                        key={card.id}
                        card={card}
                        index={cards.indexOf(card)}
                        qualityIssues={qualitySummary.reports[card.id]?.issues}
                        selected={selectedIds.has(card.id)}
                        onToggle={toggleCard}
                        onDelete={(id) => deleteCards(new Set([id]))}
                        onApprove={approveCard}
                        onOpenSource={openCardSource}
                        onUpdate={updateCard}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex min-h-[500px] flex-col items-center justify-center text-center">
                    <CheckCircle className="h-14 w-14 text-emerald-200" />
                    <p className="mt-4 font-bold text-slate-700">
                      当前筛选下没有卡片
                    </p>
                    <button
                      type="button"
                      onClick={() => setReviewFilter('all')}
                      className="mt-3 text-sm font-bold text-blue-700"
                    >
                      查看全部卡片
                    </button>
                  </div>
                )}
              </div>
            ) : pdfFile ? (
              <div className="grid flex-1 gap-4 overflow-y-auto bg-slate-100 p-3 xl:grid-cols-[minmax(0,1fr)_320px]">
                <PdfReader
                  file={pdfFile}
                  pageNumber={previewPage}
                  onPageChange={(page) => {
                    setPreviewPage(page);
                    setIsSelectingSource(false);
                  }}
                  sourceRects={
                    sourceCard?.sourcePage === previewPage
                      ? (sourceCard.sourceRects ?? [])
                      : []
                  }
                  focusMode={focusSource}
                  selectionMode={isSelectingSource}
                  onSelectRect={selectSourceRect}
                />

                <aside className="space-y-3">
                  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-slate-900">当前页卡片</h3>
                        <p className="mt-1 text-xs text-slate-500">
                          PDF 第 {previewPage} 页 · {cardsOnPreviewPage.length} 张
                        </p>
                      </div>
                      <span className="max-w-36 truncate rounded-lg bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
                        {pdfFile.name}
                      </span>
                    </div>
                    <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                      {cardsOnPreviewPage.length ? (
                        cardsOnPreviewPage.map((card) => (
                          <button
                            key={card.id}
                            type="button"
                            onClick={() => setActiveSourceCard(card.id)}
                            className={
                              'max-w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs font-bold transition ' +
                              (sourceCard?.id === card.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200')
                            }
                            title={card.question}
                          >
                            {card.question || '未命名卡片'}
                          </button>
                        ))
                      ) : (
                        <p className="text-xs leading-relaxed text-slate-400">
                          当前页还没有卡片。可选择任意卡片后，在本页重新框选原文。
                        </p>
                      )}
                    </div>
                  </section>

                  {sourceCard ? (
                    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-blue-600 px-2 py-1 text-[11px] font-bold text-white">
                          卡片 {cards.indexOf(sourceCard) + 1}
                        </span>
                        {sourceCard.sourcePage && (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                            来源第 {sourceCard.sourcePage} 页
                          </span>
                        )}
                        {sourceCard.sourceRects?.length ? (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                            已精确定位
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
                            仅页码定位
                          </span>
                        )}
                      </div>

                      <label className="mt-4 block space-y-1.5">
                        <span className="text-xs font-bold text-slate-500">问题</span>
                        <textarea
                          value={sourceCard.question}
                          onChange={(event) =>
                            updateCard(sourceCard.id, 'question', event.target.value)
                          }
                          className={inputClass + ' min-h-24 resize-y'}
                        />
                      </label>
                      <label className="mt-3 block space-y-1.5">
                        <span className="text-xs font-bold text-slate-500">答案</span>
                        <textarea
                          value={sourceCard.answer}
                          onChange={(event) =>
                            updateCard(sourceCard.id, 'answer', event.target.value)
                          }
                          className={inputClass + ' min-h-28 resize-y'}
                        />
                      </label>

                      {sourceCard.sourceQuote && (
                        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
                          <p className="text-[11px] font-bold text-blue-700">
                            提取时引用的原文
                          </p>
                          <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-line text-xs leading-relaxed text-blue-900">
                            {sourceCard.sourceQuote}
                          </p>
                          {sourceCard.sourceRects?.length ? (
                            <button
                              type="button"
                              onClick={replaceAnswerWithSourceQuote}
                              className="mt-2 rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-100"
                            >
                              用框选原文替换答案
                            </button>
                          ) : null}
                        </div>
                      )}

                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setFocusSource((current) => !current)}
                          disabled={!sourceCard.sourceRects?.length}
                          className={buttonSecondary}
                        >
                          <Focus size={15} />
                          {focusSource ? '取消遮罩' : '聚焦原文'}
                        </button>
                        <button
                          type="button"
                          onClick={toggleSourceSelection}
                          className={
                            'inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold transition ' +
                            (isSelectingSource
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
                          }
                        >
                          <MousePointer2 size={15} />
                          {isSelectingSource ? '取消框选' : '重新框选来源'}
                        </button>
                      </div>
                      {isSelectingSource ? (
                        <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
                          请在 PDF 页面上按住并拖动，松开后自动保存。
                        </p>
                      ) : sourceCard.sourceRects?.length ? (
                        <div className="mt-3">
                          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-700">
                            原文位置已保存。橙色区域是当前卡片依据。
                          </p>
                          <button
                            type="button"
                            onClick={clearSourceRects}
                            className="mt-1 w-full rounded-lg px-3 py-2 text-xs font-bold text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            清除精确定位
                          </button>
                        </div>
                      ) : (
                        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                          暂未找到精确坐标。点击“重新框选来源”绑定原文区域。
                        </p>
                      )}
                    </section>
                  ) : (
                    <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
                      添加或选择一张卡片后，即可在 PDF 上绑定原文。
                    </section>
                  )}
                </aside>
              </div>
            ) : null}
          </main>
        )}

        {currentStep === 'export' && (
          <main className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">
                第 4 步
              </p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">
                导出前质量检查
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                只有已批准且没有阻塞质量问题的卡片会进入正式牌组。
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <div className="rounded-2xl bg-violet-50 p-4 text-violet-800">
                  <p className="text-xs text-violet-600">全部卡片</p>
                  <p className="mt-2 text-3xl font-bold">{cards.length}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-800">
                  <p className="text-xs text-emerald-600">可以导出</p>
                  <p className="mt-2 text-3xl font-bold">{exportableCards.length}</p>
                </div>
                <div className="rounded-2xl bg-amber-50 p-4 text-amber-800">
                  <p className="text-xs text-amber-600">待审核</p>
                  <p className="mt-2 text-3xl font-bold">{pendingCount}</p>
                </div>
                <div className="rounded-2xl bg-violet-50 p-4 text-violet-800">
                  <p className="text-xs text-blue-600">来源待核</p>
                  <p className="mt-2 text-3xl font-bold">{sourceReviewCount}</p>
                </div>
                <div className="rounded-2xl bg-red-50 p-4 text-red-800">
                  <p className="text-xs text-red-600">质量阻塞</p>
                  <p className="mt-2 text-3xl font-bold">{blockingQualityCount}</p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="font-bold text-slate-900">导出规则</h3>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
                  <li className="flex items-start gap-2">
                    <CheckCircle className="mt-0.5 shrink-0 text-emerald-600" size={16} />
                    AI 候选卡必须经过人工批准。
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="mt-0.5 shrink-0 text-emerald-600" size={16} />
                    空字段、无效选择题、重复卡和来源未核验的 AI 卡不会进入导出。
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="mt-0.5 shrink-0 text-emerald-600" size={16} />
                    问题、答案和标签会按现有规则安全转义。
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle className="mt-0.5 shrink-0 text-emerald-600" size={16} />
                    JSON 可备份本次通过质检的卡片，TXT 和 APKG 用于导入 Anki。
                  </li>
                </ul>
              </div>

              {pendingCount > 0 && (
                <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    还有 {pendingCount} 张卡片未审核，本次只导出已批准的 {exportableCards.length} 张。
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReviewFilter('pending');
                      setCurrentStep('review');
                    }}
                    className="shrink-0 font-bold text-amber-900 hover:underline"
                  >
                    返回处理待审核卡
                  </button>
                </div>
              )}

              {blockingQualityCount > 0 && (
                <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    有 {blockingQualityCount} 张卡存在阻塞问题，本次不会导出这些卡片。
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReviewFilter('quality');
                      setCurrentStep('review');
                    }}
                    className="shrink-0 font-bold text-red-900 hover:underline"
                  >
                    返回修正
                  </button>
                </div>
              )}
            </section>

            <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="font-bold text-slate-950">牌组设置</h3>
              <label className="mt-4 block space-y-1.5 text-xs font-bold text-slate-500">
                Anki 牌组名称
                <input
                  value={settings.deckName}
                  onChange={(event) => updateSetting('deckName', event.target.value)}
                  className={inputClass}
                />
              </label>

              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  onClick={() => void exportPackage()}
                  disabled={!exportableCards.length || isExportingPackage}
                  title={
                    exportableCards.length
                      ? '导出 Anki 牌组'
                      : '没有已批准的卡片'
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isExportingPackage ? (
                    <RefreshCw size={17} className="animate-spin" />
                  ) : (
                    <FileArchive size={17} />
                  )}
                  导出 .apkg
                </button>
                <button
                  type="button"
                  onClick={exportText}
                  disabled={!exportableCards.length}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <FileText size={17} /> Anki TXT
                </button>
                <button
                  type="button"
                  onClick={exportJson}
                  disabled={!exportableCards.length}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <FileJson size={17} /> JSON 备份
                </button>
              </div>

              {!exportableCards.length && (
                <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">
                  导出不可用：请先批准至少一张没有阻塞质量问题的卡片。
                </p>
              )}
              <button
                type="button"
                onClick={() => setCurrentStep('review')}
                className="mt-5 w-full rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-50"
              >
                返回审核
              </button>
            </aside>
          </main>
        )}

        <section
          className="sticky bottom-3 z-30 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between"
          aria-label="任务状态"
          aria-live="polite"
        >
          <div className="min-w-0">
            {errorMessage ? (
              <div role="alert" className="flex items-start gap-2 text-sm font-semibold text-red-600">
                <AlertCircle className="mt-0.5 shrink-0" size={17} />
                <span>{errorMessage}</span>
              </div>
            ) : (
              <div role="status" className="flex items-start gap-2 text-sm font-semibold text-slate-600">
                {isProcessing || isExportingPackage || isAiProcessing || isTestingAi ? (
                  <RefreshCw className="mt-0.5 shrink-0 animate-spin text-blue-600" size={17} />
                ) : (
                  <CheckCircle className="mt-0.5 shrink-0 text-emerald-600" size={17} />
                )}
                <span>
                  {statusMessage ||
                    (cards.length
                      ? '草稿已自动保存 · 共 ' + cards.length + ' 张，待审核 ' + pendingCount + ' 张'
                      : sourceReady
                        ? '原文已保留，可以进入生成步骤。'
                        : '等待导入资料。')}
                </span>
              </div>
            )}
          </div>
          {(isProcessing || isAiProcessing) && (
            <button
              type="button"
              onClick={isProcessing ? cancelProcessing : cancelAiProcessing}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
            >
              取消当前任务
            </button>
          )}
          {errorMessage && aiRetryAction && !isAiProcessing && !isTestingAi && (
            <button
              type="button"
              onClick={() =>
                void (aiRetryAction === 'test'
                  ? testConnection()
                  : generateAiCandidates(true))
              }
              className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
            >
              重试 AI 任务
            </button>
          )}
        </section>
      </div>

      {isModelCenterOpen && (
        <ModelCenterModal
          settings={settings.ai}
          apiKey={apiKey}
          isTesting={isTestingAi}
          isBusy={isAiProcessing}
          connection={aiConnection}
          onClose={closeModelCenter}
          onSelectProvider={selectAiProvider}
          onUpdate={updateAiSetting}
          onApiKeyChange={updateApiKey}
          onTest={() => void testConnection()}
          onClearCache={() => void clearAiCache()}
        />
      )}
    </div>
  );
}
