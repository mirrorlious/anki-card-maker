import type {
  Card,
  ExtractedPage,
  PdfSourceRect,
  SourceTextRegion,
} from './types';

function locatorText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '');
}

function validRect(region: PdfSourceRect): boolean {
  return (
    Number.isFinite(region.x) &&
    Number.isFinite(region.y) &&
    Number.isFinite(region.width) &&
    Number.isFinite(region.height) &&
    region.width > 0 &&
    region.height > 0
  );
}

function compactRects(regions: SourceTextRegion[]): PdfSourceRect[] {
  return regions
    .filter(validRect)
    .map(({ x, y, width, height }) => ({
      x: Math.max(0, x - 0.004),
      y: Math.max(0, y - 0.003),
      width: Math.min(1 - x, width + 0.008),
      height: Math.min(1 - y, height + 0.006),
    }));
}

export function locateQuoteRegions(
  quote: string,
  regions: SourceTextRegion[],
): PdfSourceRect[] {
  const target = locatorText(quote);
  if (target.length < 4 || !regions.length) return [];

  const indexed = regions
    .map((region) => ({ region, text: locatorText(region.text) }))
    .filter((item) => item.text);
  const joined = indexed.map((item) => item.text).join('');
  let start = joined.indexOf(target);
  let length = target.length;

  if (start === -1) {
    const anchorLength = Math.min(18, Math.max(8, Math.floor(target.length / 3)));
    const anchors = [
      target.slice(0, anchorLength),
      target.slice(
        Math.max(0, Math.floor((target.length - anchorLength) / 2)),
        Math.max(0, Math.floor((target.length - anchorLength) / 2)) +
          anchorLength,
      ),
      target.slice(-anchorLength),
    ];
    for (const anchor of anchors) {
      start = joined.indexOf(anchor);
      if (start !== -1) {
        length = anchor.length;
        break;
      }
    }
  }
  if (start === -1) return [];

  const end = start + length;
  let offset = 0;
  const matched: SourceTextRegion[] = [];
  indexed.forEach((item) => {
    const itemStart = offset;
    const itemEnd = offset + item.text.length;
    if (itemStart < end && itemEnd > start) matched.push(item.region);
    offset = itemEnd;
  });
  return compactRects(matched);
}

export function attachSourceLocations(
  cards: Card[],
  pages: ExtractedPage[],
): Card[] {
  const regionsByPage = new Map(
    pages.map((page) => [page.page, page.regions ?? []]),
  );
  return cards.map((card) => {
    if (
      card.sourceRects?.length ||
      !card.sourcePage ||
      !card.sourceQuote
    ) {
      return card;
    }
    const sourceRects = locateQuoteRegions(
      card.sourceQuote,
      regionsByPage.get(card.sourcePage) ?? [],
    );
    return sourceRects.length ? { ...card, sourceRects } : card;
  });
}
