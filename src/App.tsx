import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
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
import { PdfReader } from './components/PdfReader';
import {
  buildAnkiPackage,
  buildAnkiText,
  buildCardsJson,
  downloadBlob,
  exportFileName,
} from './exporters';
import {
  buildMikiCardPackage,
  buildMikiCardPackageJson,
} from './mikiCardPackage';
import { handoffMikiCardPackage } from './mikiHandoff';
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
import { clearDraft, loadDraft, saveDraft } from './storage';
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
  deckName: 'Anki ???????',
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
  if (progress.stage === 'loading') return '???? PDF...';
  if (progress.stage === 'ocr' && progress.total === 100) {
    return `${progress.detail ?? '?? OCR'}?${progress.completed}%`;
  }
  return `${progress.detail ?? '???'}?${progress.completed}/${progress.total}?`;
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitLabels(value: string): string[] {
  return value
    .split(/[,?]/)
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
  const [bulkType, setBulkType] = useState('???');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfSourcePages, setPdfSourcePages] = useState<ExtractedPage[]>([]);
  const [workspaceView, setWorkspaceView] = useState<'cards' | 'pdf'>('cards');
  const [sourceCardId, setSourceCardId] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [focusSource, setFocusSource] = useState(true);
  const [isSelectingSource, setIsSelectingSource] = useState(false);
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
          `??? ${new Date(draft.savedAt).toLocaleString()} ????`,
        );
      })
      .catch(() => {
        if (active) setErrorMessage('????????????????');
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
            ? '?????????????????????'
            : '??????????????????????????',
        );
      }
      if (result.skippedCount) {
        setStatusMessage(
          `?? ${result.cards.length} ?????? ${result.skippedCount} ???????`,
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
    setStatusMessage('??????...');
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
      setStatusMessage(
        generated.length
          ? `????? ${generated.length} ????`
          : '???????????????????????????????????? AI ????????',
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
      setErrorMessage('??? PDF ??????');
      event.target.value = '';
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('???? PDF...');
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
      setPdfFile(file);
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
          `PDF ?????????????${(error as Error).message}`,
        );
        setStatusMessage(
          `??? ${extractedPages.length} ??OCR ${ocrCount} ???????????`,
        );
        return;
      }
      replaceCards(generated);
      setStatusMessage(
        generated.length
          ? `????? ${extractedPages.length} ??OCR ${ocrCount} ????? ${generated.length} ????`
          : `PDF ??????? ${extractedPages.length} ??OCR ${ocrCount} ????????????????????????? AI ?????????`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('??? PDF ????????????');
      } else {
        setErrorMessage(`PDF ?????${(error as Error).message}`);
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
    setStatusMessage('???? AI ??...');
    try {
      const { testAiConnection } = await import('./ai');
      const model = await testAiConnection(
        { ...settings.ai, apiKey },
        controller.signal,
      );
      setStatusMessage(`AI ????????????${model}`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('AI ????????');
      } else {
        setErrorMessage(`AI ?????${(error as Error).message}`);
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
    setStatusMessage('AI ????????????...');

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
      const tokenText =
        result.usage.promptTokens || result.usage.completionTokens
          ? `??? ${result.usage.promptTokens} ?? / ${result.usage.completionTokens} ?? tokens`
          : '';
      setStatusMessage(
        `AI ?? ${uniqueCandidates.length} ?????????? ${result.skippedChunks} ??????${tokenText}????????`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatusMessage('??? AI ????????????');
      } else {
        setErrorMessage(`AI ?????${(error as Error).message}`);
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

  const openCardSource = (id: string): void => {
    const card = cards.find((candidate) => candidate.id === id);
    if (!card) return;
    if (!pdfFile) {
      setErrorMessage('?????????? PDF??????????');
      return;
    }
    setErrorMessage('');
    setSourceCardId(id);
    setPreviewPage(card.sourcePage ?? previewPage);
    setIsSelectingSource(false);
    setWorkspaceView('pdf');
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
        ? `????????? PDF ? ${previewPage} ??? OCR ???`
        : `????????????? PDF ? ${previewPage} ???????`,
    );
  };

  const toggleSourceSelection = (): void => {
    const next = !isSelectingSource;
    setIsSelectingSource(next);
    setStatusMessage(
      next
        ? '????????? PDF ??????????????'
        : '??????',
    );
  };

  const replaceAnswerWithSourceQuote = (): void => {
    const card = cards.find((candidate) => candidate.id === sourceCardId);
    if (!card?.sourceQuote) return;
    updateCard(card.id, 'answer', card.sourceQuote);
    setStatusMessage('??????????????');
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
    setStatusMessage('?????????????????????');
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
    setStatusMessage(`??? ${ids.size} ??????????`);
  };

  const undoDelete = (): void => {
    if (!lastDeletedSnapshot) return;
    setCards(lastDeletedSnapshot);
    setLastDeletedSnapshot(null);
    setStatusMessage('??????');
  };

  const approveCard = (id: string): void => {
    setCards((current) =>
      current.map((card) =>
        card.id === id ? { ...card, reviewStatus: 'approved' } : card,
      ),
    );
    setStatusMessage('AI ??????????????????');
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
    setStatusMessage(`????? ${selectedIds.size} ????`);
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
    setStatusMessage(`?? ${selectedIds.size} ????????${tag}??`);
  };

  const applyBulkType = (): void => {
    if (!bulkType.trim() || !selectedIds.size) return;
    setLastDeletedSnapshot(null);
    setCards((current) =>
      current.map((card) =>
        selectedIds.has(card.id) ? { ...card, type: bulkType.trim() } : card,
      ),
    );
    setStatusMessage(`????? ${selectedIds.size} ??????`);
  };

  const addBlankCard = (): void => {
    const card = createCard({
      question: '',
      options: '',
      answer: '',
      point: '',
      analysis: '',
      type: settings.parseMode === 'exam' ? '???' : '???',
      chapter: '',
      tags: ['????'],
      origin: 'manual',
    });
    setLastDeletedSnapshot(null);
    setCards((current) => [card, ...current]);
    setSourceCardId(card.id);
    setStatusMessage('????????????????');
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

  const exportMikiPackage = (): void => {
    if (!exportableCards.length) return;
    downloadBlob(
      new Blob([
        buildMikiCardPackageJson({
          cards: exportableCards,
          title: settings.deckName,
          sourceFileName: pdfFile?.name,
        }),
      ], { type: 'application/json;charset=utf-8' }),
      exportFileName(settings.deckName, exportableCards.length, 'miki-cards.json'),
    );
    setStatusMessage(`????? ${exportableCards.length} ??????? Miki ?????`);
  };

  const sendToMiki = async (): Promise<void> => {
    if (!exportableCards.length) return;
    const packageOptions = {
      cards: exportableCards,
      title: settings.deckName,
      sourceFileName: pdfFile?.name,
    };
    const packageData = buildMikiCardPackage(packageOptions);
    setErrorMessage('');
    setStatusMessage('???? Miki?');
    try {
      await handoffMikiCardPackage(packageData);
      setStatusMessage(`?? ${packageData.cards.length} ????? Miki ????`);
    } catch {
      downloadBlob(
        new Blob([JSON.stringify(packageData, null, 2)], { type: 'application/json;charset=utf-8' }),
        exportFileName(settings.deckName, packageData.cards.length, 'miki-cards.json'),
      );
      setStatusMessage('????????????? Miki ?????');
    }
  };

  const exportPackage = async (): Promise<void> => {
    if (!exportableCards.length || isExportingPackage) return;
    setIsExportingPackage(true);
    setErrorMessage('');
    setStatusMessage('???? Anki .apkg ?...');
    try {
      const blob = await buildAnkiPackage(exportableCards, settings.deckName);
      downloadBlob(
        blob,
        exportFileName(settings.deckName, exportableCards.length, 'apkg'),
      );
      setStatusMessage(
        `????? ${exportableCards.length} ??????? .apkg?`,
      );
    } catch (error) {
      setErrorMessage(`Anki ??????${(error as Error).message}`);
      setStatusMessage('');
    } finally {
      setIsExportingPackage(false);
    }
  };

  const resetWorkspace = async (): Promise<void> => {
    if (
      (cards.length || inputText) &&
      !window.confirm('??????????????????')
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
    setPdfSourcePages([]);
    setWorkspaceView('cards');
    setSourceCardId(null);
    setPreviewPage(1);
    setIsSelectingSource(false);
    setAiProgress(null);
    setErrorMessage('');
    setStatusMessage('???????');
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
  const sourceCard =
    cards.find((card) => card.id === sourceCardId) ?? cards[0] ?? null;
  const cardsOnPreviewPage = cards.filter(
    (card) => card.sourcePage === previewPage,
  );

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-800 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              <ScanText size={14} /> PDF ? OCR ? Anki ???
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">
                Anki ??????
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                ???????????????OCR??????????
                .apkg?
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void sendToMiki()}
              disabled={!exportableCards.length}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Sparkles size={17} /> ??? Miki
            </button>
            <button
              type="button"
              onClick={exportMikiPackage}
              disabled={!exportableCards.length}
              className={buttonSecondary}
            >
              <FileJson size={17} /> Miki ??
            </button>
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
              ?? .apkg
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
                  PDF ??
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
                  ????
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
                    ?????
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
                    ?????
                  </button>
                </div>

                <details className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-violet-800">
                    <Sparkles size={16} /> AI ???????
                  </summary>
                  <div className="mt-4 space-y-3">
                    <p className="text-xs leading-relaxed text-violet-700">
                      AI ? PDF/OCR
                      ???????????????????????????????????????????
                    </p>
                    <label className="space-y-1 text-xs font-medium text-slate-500">
                      ????
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
                        <option value="ollama">?? Ollama</option>
                        <option value="custom">
                          ??? OpenAI-compatible
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
                      ??
                      <input
                        value={settings.ai.model}
                        onChange={(event) =>
                          updateAiSetting('model', event.target.value)
                        }
                        placeholder="????"
                        className={inputClass}
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-slate-500">
                      API Key????????????
                      <input
                        type="password"
                        autoComplete="off"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={
                          settings.ai.provider === 'ollama'
                            ? '?????????'
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
                        ????
                      </button>
                      {isAiProcessing ? (
                        <button
                          type="button"
                          onClick={cancelAiProcessing}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100"
                        >
                          <XCircle size={16} /> ?? AI
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
                          <Sparkles size={16} /> ?????
                        </button>
                      )}
                    </div>

                    {aiProgress && (
                      <div className="rounded-xl bg-white px-3 py-2 text-xs text-violet-700">
                        {aiProgress.detail}?{aiProgress.completed}/
                        {aiProgress.total}?
                      </div>
                    )}

                    <details className="rounded-xl border border-violet-100 bg-white p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-600">
                        AI ?????????
                      </summary>
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <label className="space-y-1 text-xs text-slate-500">
                          ?????
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
                          ?????
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
                          ??????
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
                          ?? JSON ??
                        </label>
                      </div>
                      <label className="mt-3 block space-y-1 text-xs text-slate-500">
                        ??????
                        <textarea
                          value={settings.ai.customInstructions}
                          onChange={(event) =>
                            updateAiSetting(
                              'customInstructions',
                              event.target.value,
                            )
                          }
                          placeholder="?????????????????? 100 ??"
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
                          : '???? PDF'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        ????????????? OCR
                      </p>
                    </label>

                    {isProcessing && (
                      <button
                        type="button"
                        onClick={cancelProcessing}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100"
                      >
                        <XCircle size={17} /> ????
                      </button>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <label className="space-y-1 text-xs font-medium text-slate-500">
                        ???
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
                        ???
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
                        ????
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
                          <option value="auto">????</option>
                          <option value="ocr">?? OCR</option>
                          <option value="text">????</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-500">
                        OCR ???
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
                          ? '???????????????????????...'
                          : '????????????????????...'
                      }
                    />
                    <button
                      type="button"
                      onClick={processPastedText}
                      disabled={!inputText.trim() || isProcessing}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      <BookOpen size={18} /> ????
                    </button>
                  </div>
                )}

                {settings.parseMode === 'textbook' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-xs font-medium text-slate-500">
                      ??????
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
                      ??????
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
                      <Settings2 size={16} /> ??????
                    </summary>
                    <div className="mt-4 space-y-3">
                      <label className="space-y-1 text-xs font-medium text-slate-500">
                        ??
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
                            ?????
                          </option>
                          <option value={GENERAL_PARSER_TEMPLATE.id}>
                            ?????
                          </option>
                          <option value="custom">???</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-500">
                        ????
                        <input
                          value={settings.parserTemplate.name}
                          onChange={(event) =>
                            updateTemplate('name', event.target.value)
                          }
                          className={inputClass}
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium text-slate-500">
                        ????
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
                          ['answerLabels', '????'],
                          ['pointLabels', '????'],
                          ['analysisLabels', '????'],
                          ['trailingLabels', '????'],
                        ] as const
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className="space-y-1 text-xs font-medium text-slate-500"
                        >
                          {label}??????
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
                  Anki ????
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
                {settings.parseMode === 'textbook' ? '????' : '????'}
              </h3>
              {settings.parseMode === 'textbook' ? (
                <ul className="list-inside list-disc space-y-1.5 opacity-90">
                  <li>???????????????????? OCR?</li>
                  <li>?? OCR ?????????????????</li>
                  <li>?????????????????????????</li>
                  <li>?????????????????</li>
                </ul>
              ) : (
                <ul className="list-inside list-disc space-y-1.5 opacity-90">
                  <li>????????????????????</li>
                  <li>??????????????</li>
                  <li>???????? HTML???????</li>
                </ul>
              )}
            </section>

            <button
              type="button"
              onClick={() => void resetWorkspace()}
              className="w-full rounded-xl px-3 py-2 text-sm font-medium text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            >
              ????????????
            </button>
          </aside>

          <main className="flex min-h-[820px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="space-y-3 border-b border-slate-100 bg-slate-50/70 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="font-bold text-slate-900">
                    {workspaceView === 'pdf'
                      ? 'PDF ????'
                      : '???????'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {workspaceView === 'pdf'
                      ? '??????????????????????'
                      : '?????????????????????'}
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
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        workspaceView === 'cards'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <List size={14} /> ??
                    </button>
                    <button
                      type="button"
                      onClick={openPdfWorkspace}
                      disabled={!pdfFile}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
                        workspaceView === 'pdf'
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                      title={
                        pdfFile
                          ? `?? ${pdfFile.name}`
                          : '?? PDF ????????'
                      }
                    >
                      <MapPin size={14} /> PDF ??
                    </button>
                  </div>
                  <span className="rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700">
                    ? {cards.length} ?
                    {pendingCount > 0 ? ` ? ??? ${pendingCount}` : ''}
                  </span>
                  {inputText.trim() && (
                    <button
                      type="button"
                      onClick={processPastedText}
                      className={buttonSecondary}
                    >
                      <RefreshCw size={16} /> ????????
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={addBlankCard}
                    className={buttonSecondary}
                  >
                    <Plus size={16} /> ????
                  </button>
                </div>
              </div>

              {workspaceView === 'cards' && cards.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleAllCards}
                    className={buttonSecondary}
                  >
                    {allSelected ? '????' : '??'}
                  </button>
                  {selectedCount > 0 && (
                    <>
                      <span className="text-sm font-medium text-blue-700">
                        ?? {selectedCount} ?
                      </span>
                      {selectedPendingCount > 0 && (
                        <button
                          type="button"
                          onClick={approveSelected}
                          className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                        >
                          <CheckCircle size={16} /> ????
                        </button>
                      )}
                      <div className="flex min-w-52 flex-1 items-center gap-2">
                        <input
                          value={bulkTag}
                          onChange={(event) => setBulkTag(event.target.value)}
                          placeholder="??????"
                          className={inputClass}
                        />
                        <button
                          type="button"
                          onClick={applyBulkTag}
                          disabled={!bulkTag.trim()}
                          className={buttonSecondary}
                        >
                          <Tags size={16} /> ??
                        </button>
                      </div>
                      <select
                        value={bulkType}
                        onChange={(event) => setBulkType(event.target.value)}
                        className={`${inputClass} w-auto`}
                      >
                        <option>???</option>
                        <option>????</option>
                        <option>???</option>
                        <option>???</option>
                      </select>
                      <button
                        type="button"
                        onClick={applyBulkType}
                        className={buttonSecondary}
                      >
                        ?????
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCards(selectedIds)}
                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100"
                      >
                        <Trash2 size={16} /> ????
                      </button>
                    </>
                  )}
                </div>
              )}

              {lastDeletedSnapshot && (
                <div className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span>??????</span>
                  <button
                    type="button"
                    onClick={undoDelete}
                    className="inline-flex items-center gap-1 font-semibold hover:underline"
                  >
                    <RotateCcw size={15} /> ????
                  </button>
                </div>
              )}
            </div>

            {workspaceView === 'cards' ? (
              <div className="flex-1 overflow-y-auto p-4">
                {cards.length === 0 ? (
                  <div className="flex h-full min-h-[620px] flex-col items-center justify-center px-8 text-center text-slate-400">
                    <FileText className="mb-4 h-16 w-16 opacity-20" />
                    <p className="font-medium text-slate-500">????</p>
                    <p className="mt-2 max-w-md text-sm">
                      {inputText.trim()
                        ? '???????????????????????????? AI ????????'
                        : '?? PDF ?????????????????????????????'}
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
                        onOpenSource={openCardSource}
                        onUpdate={updateCard}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : pdfFile ? (
              <div className="grid flex-1 gap-4 overflow-y-auto bg-slate-100 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
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
                        <h3 className="font-bold text-slate-900">
                          ?????
                        </h3>
                        <p className="mt-1 text-xs text-slate-500">
                          PDF ? {previewPage} ? ? {cardsOnPreviewPage.length}{' '}
                          ?
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
                            className={`max-w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition ${
                              sourceCard?.id === card.id
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                            title={card.question}
                          >
                            {card.question || '?????'}
                          </button>
                        ))
                      ) : (
                        <p className="text-xs leading-relaxed text-slate-400">
                          ????????????????????????????
                        </p>
                      )}
                    </div>
                  </section>

                  {sourceCard ? (
                    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-950 px-2 py-1 text-[11px] font-bold text-white">
                          ?? {cards.indexOf(sourceCard) + 1}
                        </span>
                        {sourceCard.sourcePage && (
                          <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                            ??? {sourceCard.sourcePage} ?
                          </span>
                        )}
                        {sourceCard.sourceRects?.length ? (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                            ?????
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">
                            ?????
                          </span>
                        )}
                      </div>

                      <label className="mt-4 block space-y-1.5">
                        <span className="text-xs font-semibold text-slate-500">
                          ??
                        </span>
                        <textarea
                          value={sourceCard.question}
                          onChange={(event) =>
                            updateCard(
                              sourceCard.id,
                              'question',
                              event.target.value,
                            )
                          }
                          className={`${inputClass} min-h-24 resize-y`}
                        />
                      </label>
                      <label className="mt-3 block space-y-1.5">
                        <span className="text-xs font-semibold text-slate-500">
                          ??
                        </span>
                        <textarea
                          value={sourceCard.answer}
                          onChange={(event) =>
                            updateCard(
                              sourceCard.id,
                              'answer',
                              event.target.value,
                            )
                          }
                          className={`${inputClass} min-h-28 resize-y`}
                        />
                      </label>

                      {sourceCard.sourceQuote && (
                        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
                          <p className="text-[11px] font-bold text-blue-700">
                            ????????
                          </p>
                          <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-line text-xs leading-relaxed text-blue-900">
                            {sourceCard.sourceQuote}
                          </p>
                          {sourceCard.sourceRects?.length ? (
                            <button
                              type="button"
                              onClick={replaceAnswerWithSourceQuote}
                              className="mt-2 rounded-lg bg-white px-2.5 py-1.5 text-xs font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100"
                            >
                              ?????????
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
                          {focusSource ? '????' : '????'}
                        </button>
                        <button
                          type="button"
                          onClick={toggleSourceSelection}
                          className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                            isSelectingSource
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <MousePointer2 size={15} />
                          {isSelectingSource ? '????' : '??????'}
                        </button>
                      </div>
                      {isSelectingSource ? (
                        <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
                          ?? PDF ??????????????????????????????????????????????????????????
                        </p>
                      ) : sourceCard.sourceRects?.length ? (
                        <div className="mt-3">
                          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-700">
                            ?????????????????????????????????????????????
                          </p>
                        <button
                          type="button"
                          onClick={clearSourceRects}
                            className="mt-1 w-full rounded-lg px-3 py-2 text-xs font-semibold text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                        >
                          ??????
                        </button>
                        </div>
                      ) : (
                        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                          ?????????????????????????????????????????
                        </p>
                      )}
                    </section>
                  ) : (
                    <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-400">
                      ?????????????? PDF ??????
                    </section>
                  )}
                </aside>
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}
