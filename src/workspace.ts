import type {
  AppSettings,
  Card,
  ExtractedPage,
} from './types.ts';

export interface WorkspaceBackup {
  kind: 'anki-card-maker-workspace';
  version: 1;
  exportedAt: number;
  inputText: string;
  cards: Card[];
  settings: AppSettings;
  pdfSourcePages: ExtractedPage[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCard(value: unknown): value is Card {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.question === 'string' &&
    typeof value.answer === 'string' &&
    typeof value.options === 'string' &&
    typeof value.point === 'string' &&
    typeof value.analysis === 'string' &&
    typeof value.type === 'string' &&
    typeof value.chapter === 'string' &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    ['local', 'ai', 'manual'].includes(String(value.origin)) &&
    ['pending', 'approved'].includes(String(value.reviewStatus))
  );
}

function isExtractedPage(value: unknown): value is ExtractedPage {
  return (
    isObject(value) &&
    typeof value.page === 'number' &&
    Number.isFinite(value.page) &&
    typeof value.text === 'string' &&
    ['text', 'ocr'].includes(String(value.method))
  );
}

function isSettings(value: unknown): value is AppSettings {
  if (!isObject(value) || !isObject(value.ai) || !isObject(value.parserTemplate)) {
    return false;
  }
  return (
    ['upload', 'text'].includes(String(value.activeTab)) &&
    ['textbook', 'exam'].includes(String(value.parseMode)) &&
    ['auto', 'text', 'ocr'].includes(String(value.extractMode)) &&
    typeof value.deckName === 'string' &&
    typeof value.ai.baseUrl === 'string' &&
    typeof value.ai.model === 'string' &&
    typeof value.parserTemplate.questionPattern === 'string'
  );
}

export function buildWorkspaceBackup(
  inputText: string,
  cards: Card[],
  settings: AppSettings,
  pdfSourcePages: ExtractedPage[],
  exportedAt = Date.now(),
): string {
  const backup: WorkspaceBackup = {
    kind: 'anki-card-maker-workspace',
    version: 1,
    exportedAt,
    inputText,
    cards,
    settings,
    pdfSourcePages,
  };
  return JSON.stringify(backup, null, 2);
}

export function parseWorkspaceBackup(text: string): WorkspaceBackup {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error('备份文件不是有效的 JSON。');
  }
  if (!isObject(value)) throw new Error('备份文件顶层格式无效。');
  if (value.kind !== 'anki-card-maker-workspace' || value.version !== 1) {
    throw new Error('这不是受支持的 Anki 制卡器工作区备份。');
  }
  if (
    typeof value.exportedAt !== 'number' ||
    typeof value.inputText !== 'string' ||
    !Array.isArray(value.cards) ||
    !value.cards.every(isCard) ||
    !isSettings(value.settings) ||
    !Array.isArray(value.pdfSourcePages) ||
    !value.pdfSourcePages.every(isExtractedPage)
  ) {
    throw new Error('备份文件缺少必要字段或包含无效卡片数据。');
  }
  return value as unknown as WorkspaceBackup;
}
