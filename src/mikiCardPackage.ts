import type { Card, PdfSourceRect } from './types';

export const MIKI_CARD_PACKAGE_FORMAT = 'miki-card-package';
export const MIKI_CARD_PACKAGE_SCHEMA_VERSION = 1;
export const MIKI_CARD_PACKAGE_MAX_CARDS = 500;

const MAX_TITLE_LENGTH = 300;
const MAX_FRONT_LENGTH = 1_200;
const MAX_BACK_LENGTH = 8_000;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 80;
const MAX_QUOTE_LENGTH = 1_000;
const MAX_RECTS = 12;

export interface MikiCardPackageV1 {
  format: typeof MIKI_CARD_PACKAGE_FORMAT;
  schemaVersion: typeof MIKI_CARD_PACKAGE_SCHEMA_VERSION;
  packageId: string;
  createdAt: string;
  title: string;
  generator: {
    id: 'anki-card-maker';
    version: string;
  };
  source: {
    kind: 'pdf' | 'text';
    fileName?: string;
  };
  cards: MikiCardPackageCardV1[];
}

export interface MikiCardPackageCardV1 {
  id: string;
  type: 'qa' | 'choice' | 'cloze';
  front: string;
  back: string;
  tags: string[];
  provenance?: {
    chapter?: string;
    page?: number;
    quote?: string;
    confidence?: number;
    rects?: PdfSourceRect[];
  };
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '').replaceAll('\u0000', '').trim().slice(0, maxLength);
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => cleanText(tag, MAX_TAG_LENGTH)).filter(Boolean))]
    .slice(0, MAX_TAGS);
}

function cleanRects(rects: PdfSourceRect[] | undefined): PdfSourceRect[] {
  return (Array.isArray(rects) ? rects : [])
    .slice(0, MAX_RECTS)
    .map(({ x, y, width, height }) => ({ x, y, width, height }))
    .filter((rect) => Object.values(rect).every(Number.isFinite));
}

function getCardType(card: Card): MikiCardPackageCardV1['type'] {
  const type = cleanText(card.type, 80).toLowerCase();
  if (/选择|choice|单选|多选/.test(type) || cleanText(card.options, MAX_FRONT_LENGTH)) {
    return 'choice';
  }
  if (/填空|cloze/.test(type)) return 'cloze';
  return 'qa';
}

function buildPlainFront(card: Card): string {
  return cleanText(
    [cleanText(card.question, MAX_FRONT_LENGTH), cleanText(card.options, MAX_FRONT_LENGTH)]
      .filter(Boolean)
      .join('\n\n'),
    MAX_FRONT_LENGTH,
  );
}

function buildPlainBack(card: Card): string {
  return cleanText([
    card.answer ? `答案：${cleanText(card.answer, MAX_BACK_LENGTH)}` : '',
    card.point ? `考点：${cleanText(card.point, MAX_BACK_LENGTH)}` : '',
    card.analysis ? `解析：${cleanText(card.analysis, MAX_BACK_LENGTH)}` : '',
  ].filter(Boolean).join('\n\n'), MAX_BACK_LENGTH);
}

function defaultPackageIdFactory(): string {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `mcp_${randomId}`;
}

export function buildMikiCardPackage({
  cards,
  title,
  sourceFileName = '',
  createdAt = new Date().toISOString(),
  packageId = defaultPackageIdFactory(),
  generatorVersion = '1.0.0',
}: {
  cards: Card[];
  title: string;
  sourceFileName?: string;
  createdAt?: string;
  packageId?: string;
  generatorVersion?: string;
}): MikiCardPackageV1 {
  const approvedCards = cards
    .filter((card) => card.reviewStatus === 'approved')
    .slice(0, MIKI_CARD_PACKAGE_MAX_CARDS)
    .map((card, index): MikiCardPackageCardV1 | null => {
      const front = buildPlainFront(card);
      const back = buildPlainBack(card);
      if (!front || !back) return null;

      const provenance = {
        ...(cleanText(card.chapter, MAX_TITLE_LENGTH) ? { chapter: cleanText(card.chapter, MAX_TITLE_LENGTH) } : {}),
        ...(Number.isInteger(card.sourcePage) && Number(card.sourcePage) > 0 ? { page: Number(card.sourcePage) } : {}),
        ...(cleanText(card.sourceQuote, MAX_QUOTE_LENGTH) ? { quote: cleanText(card.sourceQuote, MAX_QUOTE_LENGTH) } : {}),
        ...(Number.isFinite(card.confidence) ? { confidence: Math.max(0, Math.min(1, Number(card.confidence))) } : {}),
        ...(cleanRects(card.sourceRects).length ? { rects: cleanRects(card.sourceRects) } : {}),
      };

      return {
        id: cleanText(card.id, 180) || `card-${index + 1}`,
        type: getCardType(card),
        front,
        back,
        tags: cleanTags(card.tags),
        ...(Object.keys(provenance).length ? { provenance } : {}),
      };
    })
    .filter((card): card is MikiCardPackageCardV1 => Boolean(card));

  if (approvedCards.length === 0) {
    throw new Error('没有可导出的已审核卡片。');
  }

  const safeCreatedAt = new Date(createdAt);
  if (Number.isNaN(safeCreatedAt.getTime())) throw new Error('导出时间无效。');

  const fileName = cleanText(sourceFileName, MAX_TITLE_LENGTH);
  return {
    format: MIKI_CARD_PACKAGE_FORMAT,
    schemaVersion: MIKI_CARD_PACKAGE_SCHEMA_VERSION,
    packageId: cleanText(packageId, 180) || defaultPackageIdFactory(),
    createdAt: safeCreatedAt.toISOString(),
    title: cleanText(title, MAX_TITLE_LENGTH) || '未命名卡组',
    generator: {
      id: 'anki-card-maker',
      version: cleanText(generatorVersion, 40) || '1.0.0',
    },
    source: {
      kind: fileName ? 'pdf' : 'text',
      ...(fileName ? { fileName } : {}),
    },
    cards: approvedCards,
  };
}

export function buildMikiCardPackageJson(options: Parameters<typeof buildMikiCardPackage>[0]): string {
  return JSON.stringify(buildMikiCardPackage(options), null, 2);
}
