import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle,
  FileArchive,
  FileJson,
  FileText,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanText,
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
import { clearDraft, loadDraft, saveDraft } from './storage';
import type {
  AppSettings,
  AiProgress,
  AiSettings,
  Card,
  DraftData,
  ParserTemplate,
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
  const [apiKey, setApiKey] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [bulkTag, setBulkTag] = useState('');
  const [bulkType, setBulkType] = useState('简答题');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const aiAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void loadDraft()
      .then((draft) => {
        if (!active || !draft || draft.version !== 1) return;
        setInputText(draft.inputText);
        setCards(
          draft.cards.map((card) => ({
            ...card,
            origin: card.origin ?? 'local',
            reviewStatus: card.reviewStatus ?? 'approved',
          })),
        );
        setSettings(normalizeDraftSettings(draft.settings));
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
    setSettings((current) => ({
      ...current,
      ai: { ...current.ai, [key]: value },
    }));
  };

  const replaceCards = (generated: Card[]): void => {
    setCards(generated);
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
          ? pagesFromExtractedText(inputText)
          : undefined,
      );
      replaceCards(generated);
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

  const handleFileUpload = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file || isProcessing) return;
    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      setErrorMessage('请选择 PDF 格式的文件。');
      event.target.value = '';
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('准备读取 PDF...');
    setPdfProgress({ stage: 'loading', completed: 0, total: 0 });

    try {
      const { extractPdfPages } = await import('./pdf');
      const extractedPages = await extractPdfPages(file, {
        pageStart: parsePositiveInt(settings.pageStart, 1),
        pageEnd: parsePositiveInt(settings.pageEnd, 30),
        extractMode: settings.extractMode,
        ocrScale: Number.parseFloat(settings.ocrScale) || 1.8,
        signal: controller.signal,
        onProgress: setPdfProgress,
      });
      const fullText = extractedPages
        .map(
          (page) =>
            `--- PAGE ${page.page} [${page.method}] ---\n${page.text}`,
        )
        .join('\n\n');
      const ocrCount = extractedPages.filter(
        (page) => page.method === 'ocr',
      ).length;
      setInputText(fullText);
      let generated: Card[];
      try {
        generated = generateCards(fullText, extractedPages);
      } catch (error) {
        setErrorMessage(
          `PDF 已成功读取，但制卡未完成：${(error as Error).message}`,
        );
        setStatusMessage(
          `已读取 ${extractedPages.length} 页（OCR ${ocrCount} 页），提取原文已保留。`,
        );
        return;
      }
      replaceCards(generated);
      setStatusMessage(
        generated.length
          ? `完成：读取 ${extractedPages.length} 页（OCR ${ocrCount} 页），生成 ${generated.length} 张卡片。`
          : `PDF 提取完成：读取 ${extractedPages.length} 页（OCR ${ocrCount} 页）。本地规则暂未生成卡片，原文已保留，可直接使用 AI 辅助或添加空白卡。`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('已取消 PDF 处理，原有卡片未被覆盖。');
      } else {
        setErrorMessage(`PDF 处理失败：${(error as Error).message}`);
        setStatusMessage('');
      }
    } finally {
      abortControllerRef.current = null;
      setIsProcessing(false);
      setPdfProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const cancelProcessing = (): void => {
    abortControllerRef.current?.abort();
  };

  const selectAiProvider = (provider: AiSettings['provider']): void => {
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
    setErrorMessage('');
    setStatusMessage('正在测试 AI 接口...');
    try {
      const { testAiConnection } = await import('./ai');
      const model = await testAiConnection(
        { ...settings.ai, apiKey },
        controller.signal,
      );
      setStatusMessage(`AI 接口连接成功，响应模型：${model}`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('AI 连接测试已取消。');
      } else {
        setErrorMessage(`AI 连接失败：${(error as Error).message}`);
        setStatusMessage('');
      }
    } finally {
      aiAbortControllerRef.current = null;
      setIsTestingAi(false);
    }
  };

  const generateAiCandidates = async (): Promise<void> => {
    if (!inputText.trim() || isAiProcessing || isTestingAi) return;
    const controller = new AbortController();
    aiAbortControllerRef.current = controller;
    setIsAiProcessing(true);
    setAiProgress(null);
    setErrorMessage('');
    setStatusMessage('AI 正在分析原文并生成候选卡...');

    try {
      const { generateCardsWithAi } = await import('./ai');
      const result = await generateCardsWithAi(
        inputText,
        { ...settings.ai, apiKey },
        {
          signal: controller.signal,
          onProgress: setAiProgress,
        },
      );
      const existing = new Set(cards.map(cardIdentity));
      const uniqueCandidates = result.cards.filter((card) => {
        const key = cardIdentity(card);
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
      });
      setCards((current) => [...uniqueCandidates, ...current]);
      setSelectedIds(new Set());
      const tokenText =
        result.usage.promptTokens || result.usage.completionTokens
          ? `，使用 ${result.usage.promptTokens} 输入 / ${result.usage.completionTokens} 输出 tokens`
          : '';
      setStatusMessage(
        `AI 生成 ${uniqueCandidates.length} 张不重复候选卡，跳过 ${result.skippedChunks} 个异常文本块${tokenText}。请审核后批准。`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('已取消 AI 制卡，现有卡片未受影响。');
      } else {
        setErrorMessage(`AI 制卡失败：${(error as Error).message}`);
        setStatusMessage('');
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

  const deleteCards = (ids: Set<string>): void => {
    if (!ids.size) return;
    setLastDeletedSnapshot(cards);
    setCards((current) => current.filter((card) => !ids.has(card.id)));
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
    setCards((current) =>
      current.map((card) =>
        card.id === id ? { ...card, reviewStatus: 'approved' } : card,
      ),
    );
    setStatusMessage('AI 候选卡已批准，可随其他卡片一起导出。');
  };

  const approveSelected = (): void => {
    if (!selectedIds.size) return;
    setCards((current) =>
      current.map((card) =>
        selectedIds.has(card.id)
          ? { ...card, reviewStatus: 'approved' }
          : card,
      ),
    );
    setStatusMessage(`已批准所选 ${selectedIds.size} 张卡片。`);
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
    setAiProgress(null);
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
  const exportableCards = cards.filter(
    (card) => card.reviewStatus === 'approved',
  );
  const pendingCount = cards.length - exportableCards.length;
  const selectedCount = selectedIds.size;
  const selectedPendingCount = cards.filter(
    (card) =>
      selectedIds.has(card.id) && card.reviewStatus === 'pending',
  ).length;
  const allSelected = cards.length > 0 && selectedCount === cards.length;

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <ScanText size={14} /> PDF · OCR · Anki 一体化
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">
                Anki 批量制卡引擎
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                兼容教材与题库，支持本地解析、OCR、人工精修和直接导出
                .apkg。
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportJson}
              disabled={!exportableCards.length}
              className={buttonSecondary}
            >
              <FileJson size={17} /> JSON
            </button>
            <button
              type="button"
              onClick={exportText}
              disabled={!exportableCards.length}
              className={buttonSecondary}
            >
              <FileText size={17} /> Anki TXT
            </button>
            <button
              type="button"
              onClick={() => void exportPackage()}
              disabled={!exportableCards.length || isExportingPackage}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isExportingPackage ? (
                <RefreshCw size={17} className="animate-spin" />
              ) : (
                <FileArchive size={17} />
              )}
              导出 .apkg
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[390px_1fr]">
          <aside className="space-y-4">
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex border-b border-slate-100">
                <button
                  type="button"
                  aria-pressed={settings.activeTab === 'upload'}
                  onClick={() => updateSetting('activeTab', 'upload')}
                  className={`flex-1 py-3 text-sm font-medium transition ${
                    settings.activeTab === 'upload'
                      ? 'border-b-2 border-blue-600 bg-blue-50 text-blue-700'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  PDF 上传
                </button>
                <button
                  type="button"
                  aria-pressed={settings.activeTab === 'text'}
                  onClick={() => updateSetting('activeTab', 'text')}
                  className={`flex-1 py-3 text-sm font-medium transition ${
                    settings.activeTab === 'text'
                      ? 'border-b-2 border-blue-600 bg-blue-50 text-blue-700'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  文本粘贴
                </button>
              </div>

              <div className="space-y-5 p-5">
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => updateSetting('parseMode', 'textbook')}
                    className={`rounded-xl py-2 text-sm font-semibold transition ${
                      settings.parseMode === 'textbook'
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-slate-500'
                    }`}
                  >
                    教材背诵卡
                  </button>
                  <button
                    type="button"
                    onClick={() => updateSetting('parseMode', 'exam')}
                    className={`rounded-xl py-2 text-sm font-semibold transition ${
                      settings.parseMode === 'exam'
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-slate-500'
                    }`}
                  >
                    题库解析卡
                  </button>
                </div>

                <details className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-violet-800">
                    <Sparkles size={16} /> AI 辅助生成候选卡
                  </summary>
                  <div className="mt-4 space-y-3">
                    <p className="text-xs leading-relaxed text-violet-700">
                      AI 在 PDF/OCR
                      提取之后介入：拆分知识点、生成卡片并补充标签。结果默认标记为待审核，不会覆盖现有卡片。
                    </p>
                    <label className="space-y-1 text-xs font-medium text-slate-500">
                      接口预设
                      <select
                        value={settings.ai.provider}
                        onChange={(event) =>
                          selectAiProvider(
                            event.target.value as AiSettings['provider'],
                          )
                        }
                        className={inputClass}
                      >
                        <option value="deepseek">DeepSeek</option>
                        <option value="ollama">本地 Ollama</option>
                        <option value="custom">
                          自定义 OpenAI-compatible
                        </option>
                      </select>
                    </label>
                    <label className="space-y-1 text-xs font-medium text-slate-500">
                      Base URL
                      <input
                        value={settings.ai.baseUrl}
                        onChange={(event) =>
                          updateAiSetting('baseUrl', event.target.value)
                        }
                        placeholder="https://api.example.com/v1"
                        className={inputClass}
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-slate-500">
                      模型
                      <input
                        value={settings.ai.model}
                        onChange={(event) =>
                          updateAiSetting('model', event.target.value)
                        }
                        placeholder="模型名称"
                        className={inputClass}
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-slate-500">
                      API Key（仅保存在当前页面会话）
                      <input
                        type="password"
                        autoComplete="off"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={
                          settings.ai.provider === 'ollama'
                            ? '本地接口通常可留空'
                            : 'sk-...'
                        }
                        className={inputClass}
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void testConnection()}
                        disabled={isTestingAi || isAiProcessing}
                        className={buttonSecondary}
                      >
                        {isTestingAi ? (
                          <RefreshCw size={16} className="animate-spin" />
                        ) : (
                          <CheckCircle size={16} />
                        )}
                        测试连接
                      </button>
                      {isAiProcessing ? (
                        <button
                          type="button"
                          onClick={cancelAiProcessing}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100"
                        >
                          <XCircle size={16} /> 取消 AI
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void generateAiCandidates()}
                          disabled={
                            !inputText.trim() ||
                            !settings.ai.model.trim() ||
                            isTestingAi
                          }
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          <Sparkles size={16} /> 生成候选卡
                        </button>
                      )}
                    </div>

                    {aiProgress && (
                      <div className="rounded-xl bg-white px-3 py-2 text-xs text-violet-700">
                        {aiProgress.detail}（{aiProgress.completed}/
                        {aiProgress.total}）
                      </div>
                    )}

                    <details className="rounded-xl border border-violet-100 bg-white p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                        AI 调用范围与高级设置
                      </summary>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <label className="space-y-1 text-xs text-slate-500">
                          每块字符数
                          <input
                            type="number"
                            min="1000"
                            max="30000"
                            value={settings.ai.chunkSize}
                            onChange={(event) =>
                              updateAiSetting('chunkSize', event.target.value)
                            }
                            className={inputClass}
                          />
                        </label>
                        <label className="space-y-1 text-xs text-slate-500">
                          最多文本块
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={settings.ai.maxChunks}
                            onChange={(event) =>
                              updateAiSetting('maxChunks', event.target.value)
                            }
                            className={inputClass}
                          />
                        </label>
                        <label className="space-y-1 text-xs text-slate-500">
                          每块最多卡片
                          <input
                            type="number"
                            min="1"
                            max="30"
                            value={settings.ai.cardsPerChunk}
                            onChange={(event) =>
                              updateAiSetting(
                                'cardsPerChunk',
                                event.target.value,
                              )
                            }
                            className={inputClass}
                          />
                        </label>
                        <label className="flex items-center gap-2 self-end rounded-xl border border-slate-200 px-3 py-2.5 text-xs text-slate-600">
                          <input
                            type="checkbox"
                            checked={settings.ai.jsonMode}
                            onChange={(event) =>
                              updateAiSetting('jsonMode', event.target.checked)
                            }
                          />
                          请求 JSON 模式
                        </label>
                      </div>
                      <label className="mt-3 block space-y-1 text-xs text-slate-500">
                        补充制卡要求
                        <textarea
                          value={settings.ai.customInstructions}
                          onChange={(event) =>
                            updateAiSetting(
                              'customInstructions',
                              event.target.value,
                            )
                          }
                          placeholder="例如：优先生成罪名辨析卡；答案不超过 100 字。"
                          className={`${inputClass} min-h-20 resize-y`}
                        />
                      </label>
                    </details>
                  </div>
                </details>

                {settings.activeTab === 'upload' ? (
                  <div className="space-y-4">
                    <input
                      id="pdf-upload"
                      type="file"
                      accept="application/pdf,.pdf"
                      className="sr-only"
                      ref={fileInputRef}
                      disabled={isProcessing}
                      onChange={(event) => void handleFileUpload(event)}
                    />
                    <label
                      htmlFor="pdf-upload"
                      aria-disabled={isProcessing}
                      className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition ${
                        isProcessing
                          ? 'cursor-wait border-blue-300 bg-blue-50'
                          : 'cursor-pointer border-slate-200 hover:border-blue-300 hover:bg-slate-50'
                      }`}
                    >
                      {isProcessing ? (
                        <RefreshCw className="mb-3 h-10 w-10 animate-spin text-blue-500" />
                      ) : (
                        <UploadCloud className="mb-3 h-10 w-10 text-slate-400" />
                      )}
                      <p className="text-sm font-semibold text-slate-700">
                        {isProcessing
                          ? progressText(pdfProgress)
                          : '点击上传 PDF'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        文本层优先；扫描页按需调用 OCR
                      </p>
                    </label>

                    {isProcessing && (
                      <button
                        type="button"
                        onClick={cancelProcessing}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100"
                      >
                        <XCircle size={17} /> 取消处理
                      </button>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <label className="space-y-1 text-xs font-medium text-slate-500">
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
                      <label className="space-y-1 text-xs font-medium text-slate-500">
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
                      <label className="space-y-1 text-xs font-medium text-slate-500">
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
                      <label className="space-y-1 text-xs font-medium text-slate-500">
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
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <textarea
                      value={inputText}
                      onChange={(event) => setInputText(event.target.value)}
                      className="h-64 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-blue-500"
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
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <BookOpen size={18} /> 开始制卡
                    </button>
                  </div>
                )}

                {settings.parseMode === 'textbook' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-xs font-medium text-slate-500">
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
                    <label className="space-y-1 text-xs font-medium text-slate-500">
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
                  <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-700">
                      <Settings2 size={16} /> 题库解析模板
                    </summary>
                    <div className="mt-4 space-y-3">
                      <label className="space-y-1 text-xs font-medium text-slate-500">
                        预设
                        <select
                          value={
                            settings.parserTemplate.id ===
                            GENERAL_PARSER_TEMPLATE.id
                              ? GENERAL_PARSER_TEMPLATE.id
                              : settings.parserTemplate.id ===
                                  DEFAULT_PARSER_TEMPLATE.id
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
                          <option value={DEFAULT_PARSER_TEMPLATE.id}>
                            刑法母子题
                          </option>
                          <option value={GENERAL_PARSER_TEMPLATE.id}>
                            通用选择题
                          </option>
                          <option value="custom">自定义</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-500">
                        模板名称
                        <input
                          value={settings.parserTemplate.name}
                          onChange={(event) =>
                            updateTemplate('name', event.target.value)
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-500">
                        题号正则
                        <textarea
                          value={settings.parserTemplate.questionPattern}
                          onChange={(event) =>
                            updateTemplate(
                              'questionPattern',
                              event.target.value,
                            )
                          }
                          className={`${inputClass} min-h-20 font-mono`}
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
                        <label
                          key={key}
                          className="space-y-1 text-xs font-medium text-slate-500"
                        >
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

                <label className="space-y-1 text-xs font-medium text-slate-500">
                  Anki 牌组名称
                  <input
                    value={settings.deckName}
                    onChange={(event) =>
                      updateSetting('deckName', event.target.value)
                    }
                    className={inputClass}
                  />
                </label>

                {statusMessage && (
                  <div
                    role="status"
                    className="flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-700"
                  >
                    {isProcessing ||
                    isExportingPackage ||
                    isAiProcessing ||
                    isTestingAi ? (
                      <RefreshCw className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin" />
                    ) : (
                      <CheckCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    )}
                    <span>{statusMessage}</span>
                  </div>
                )}
                {errorMessage && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-600"
                  >
                    <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5 text-sm text-blue-900">
              <h3 className="mb-2 flex items-center gap-2 font-semibold">
                <CheckCircle size={16} />
                {settings.parseMode === 'textbook' ? '使用建议' : '制卡说明'}
              </h3>
              {settings.parseMode === 'textbook' ? (
                <ul className="list-inside list-disc space-y-1.5 opacity-90">
                  <li>扫描教材优先使用“自动判断”，仅图片页会 OCR。</li>
                  <li>首次 OCR 会下载中文模型，之后浏览器会缓存。</li>
                  <li>建议按章处理，并在导出前人工精修。</li>
                </ul>
              ) : (
                <ul className="list-inside list-disc space-y-1.5 opacity-90">
                  <li>可切换预设或自定义题号、答案和解析标签。</li>
                  <li>不完整题目会跳过并显示数量。</li>
                  <li>导出内容自动转义 HTML，避免误执行。</li>
                </ul>
              )}
            </section>

            <button
              type="button"
              onClick={() => void resetWorkspace()}
              className="w-full rounded-xl px-3 py-2 text-sm font-medium text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            >
              清空当前工作区与本地草稿
            </button>
          </aside>

          <main className="flex min-h-[820px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-3 border-b border-slate-100 bg-slate-50/70 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="font-bold text-slate-900">卡片预览与精修</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    全字段可编辑；草稿会自动保存在本机浏览器。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">
                    共 {cards.length} 张
                    {pendingCount > 0 ? ` · 待审核 ${pendingCount}` : ''}
                  </span>
                  {inputText.trim() && (
                    <button
                      type="button"
                      onClick={processPastedText}
                      className={buttonSecondary}
                    >
                      <RefreshCw size={16} /> 重新生成本地卡片
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={addBlankCard}
                    className={buttonSecondary}
                  >
                    <Plus size={16} /> 添加卡片
                  </button>
                </div>
              </div>

              {cards.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleAllCards}
                    className={buttonSecondary}
                  >
                    {allSelected ? '取消全选' : '全选'}
                  </button>
                  {selectedCount > 0 && (
                    <>
                      <span className="text-sm font-medium text-blue-700">
                        已选 {selectedCount} 张
                      </span>
                      {selectedPendingCount > 0 && (
                        <button
                          type="button"
                          onClick={approveSelected}
                          className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100"
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
                        className={`${inputClass} w-auto`}
                      >
                        <option>选择题</option>
                        <option>名词解释</option>
                        <option>简答题</option>
                        <option>填空题</option>
                      </select>
                      <button
                        type="button"
                        onClick={applyBulkType}
                        className={buttonSecondary}
                      >
                        批量改类型
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCards(selectedIds)}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100"
                      >
                        <Trash2 size={16} /> 删除所选
                      </button>
                    </>
                  )}
                </div>
              )}

              {lastDeletedSnapshot && (
                <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span>卡片已删除。</span>
                  <button
                    type="button"
                    onClick={undoDelete}
                    className="inline-flex items-center gap-1 font-semibold hover:underline"
                  >
                    <RotateCcw size={15} /> 撤销删除
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {cards.length === 0 ? (
                <div className="flex h-full min-h-[620px] flex-col items-center justify-center px-8 text-center text-slate-400">
                  <FileText className="mb-4 h-16 w-16 opacity-20" />
                  <p className="font-medium text-slate-500">暂无卡片</p>
                  <p className="mt-2 max-w-md text-sm">
                    {inputText.trim()
                      ? '原文已经提取，可重新生成本地卡片、添加空白卡，或使用左侧 AI 辅助生成候选卡。'
                      : '上传 PDF 或粘贴文本。系统生成草稿后，可在这里修改、批量整理并导出。'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {cards.map((card, index) => (
                    <CardEditor
                      key={card.id}
                      card={card}
                      index={index}
                      selected={selectedIds.has(card.id)}
                      onToggle={toggleCard}
                      onDelete={(id) => deleteCards(new Set([id]))}
                      onApprove={approveCard}
                      onUpdate={updateCard}
                    />
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
