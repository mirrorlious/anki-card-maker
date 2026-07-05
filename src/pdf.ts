import {
  getDocument,
  GlobalWorkerOptions,
  Util,
  type PDFPageProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDF_DOCUMENT_ASSETS } from './pdfAssets';
import type {
  ExtractedPage,
  ExtractMode,
  PdfProgress,
  SourceTextRegion,
} from './types';

GlobalWorkerOptions.workerSrc = workerUrl;

const PDF_PAGE_CONCURRENCY = 4;
const DEFAULT_OCR_LANGUAGE = 'chi_sim+eng';

interface ExtractPdfOptions {
  pageStart: number;
  pageEnd: number;
  extractMode: ExtractMode;
  ocrScale: number;
  signal: AbortSignal;
  onProgress?: (progress: PdfProgress) => void;
}

interface NativePage {
  page: number;
  regions: SourceTextRegion[];
  text: string;
}

interface PageTextExtraction {
  regions: SourceTextRegion[];
  text: string;
}

interface OcrLine {
  bbox: { x0: number; x1: number; y0: number; y1: number };
  text: string;
}

interface OcrBlock {
  paragraphs?: Array<{ lines?: OcrLine[] }>;
}

function abortError(): DOMException {
  return new DOMException('操作已取消', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function endsWithWordCharacter(value: string): boolean {
  return /[A-Za-z0-9]$/.test(value);
}

function startsWithWordCharacter(value: string): boolean {
  return /^[A-Za-z0-9]/.test(value);
}

function normalizedRegion(
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
): SourceTextRegion | null {
  if (
    !text.trim() ||
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const left = Math.min(Math.max(x / pageWidth, 0), 1);
  const top = Math.min(Math.max(y / pageHeight, 0), 1);
  return {
    text,
    x: left,
    y: top,
    width: Math.min(Math.max(width / pageWidth, 0), 1 - left),
    height: Math.min(Math.max(height / pageHeight, 0), 1 - top),
  };
}

async function extractNativeText(
  page: PDFPageProxy,
): Promise<PageTextExtraction> {
  const textContent = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  let result = '';
  const regions: SourceTextRegion[] = [];
  let previous:
    | { endX: number; fontSize: number; text: string; y: number }
    | undefined;

  for (const item of textContent.items) {
    if (!('str' in item)) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const fontSize =
      Math.hypot(item.transform[2], item.transform[3]) || item.height || 10;
    const transformed = Util.transform(viewport.transform, item.transform);
    const renderedFontSize =
      Math.hypot(transformed[2], transformed[3]) || fontSize;
    const region = normalizedRegion(
      item.str,
      transformed[4],
      transformed[5] - renderedFontSize,
      Math.max(Math.abs(item.width), renderedFontSize * 0.2),
      renderedFontSize,
      viewport.width,
      viewport.height,
    );
    if (region) regions.push(region);

    if (previous) {
      const tolerance = Math.max(
        2,
        Math.min(previous.fontSize, fontSize) * 0.45,
      );
      if (Math.abs(y - previous.y) > tolerance) {
        if (!result.endsWith('\n')) result += '\n';
      } else {
        const gap = x - previous.endX;
        if (
          gap > Math.max(1, fontSize * 0.08) &&
          endsWithWordCharacter(previous.text) &&
          startsWithWordCharacter(item.str) &&
          !result.endsWith(' ')
        ) {
          result += ' ';
        }
      }
    }

    result += item.str;
    if (item.hasEOL) {
      if (!result.endsWith('\n')) result += '\n';
      previous = undefined;
    } else {
      previous = {
        endX: x + item.width,
        fontSize,
        text: item.str,
        y,
      };
    }
  }
  page.cleanup();
  return { text: result.trim(), regions };
}

function ocrRegions(
  blocks: OcrBlock[] | null,
  width: number,
  height: number,
): SourceTextRegion[] {
  if (!blocks) return [];
  return blocks.flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) =>
      (paragraph.lines ?? [])
        .map((line) =>
          normalizedRegion(
            line.text,
            line.bbox.x0,
            line.bbox.y0,
            line.bbox.x1 - line.bbox.x0,
            line.bbox.y1 - line.bbox.y0,
            width,
            height,
          ),
        )
        .filter((region): region is SourceTextRegion => region !== null),
    ),
  );
}

async function renderPage(page: PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 初始化失败');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
}

export async function extractPdfPages(
  file: File,
  options: ExtractPdfOptions,
): Promise<ExtractedPage[]> {
  const { signal, onProgress } = options;
  throwIfAborted(signal);
  onProgress?.({ stage: 'loading', completed: 0, total: 0 });

  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    ...PDF_DOCUMENT_ASSETS,
  });
  const abortLoading = () => {
    void loadingTask.destroy();
  };
  signal.addEventListener('abort', abortLoading, { once: true });

  try {
    const pdf = await loadingTask.promise;
    const start = clamp(options.pageStart, 1, pdf.numPages);
    const end = clamp(options.pageEnd, 1, pdf.numPages);
    const safeStart = Math.min(start, end);
    const safeEnd = Math.max(start, end);
    const pageNumbers = Array.from(
      { length: safeEnd - safeStart + 1 },
      (_, index) => safeStart + index,
    );
    const nativePages = new Array<NativePage>(pageNumbers.length);
    let nextIndex = 0;
    let completed = 0;

    const nativeWorker = async () => {
      while (nextIndex < pageNumbers.length) {
        throwIfAborted(signal);
        const index = nextIndex;
        nextIndex += 1;
        const pageNumber = pageNumbers[index];
        const page = await pdf.getPage(pageNumber);
        const extraction = await extractNativeText(page);
        nativePages[index] = {
          page: pageNumber,
          ...extraction,
        };
        completed += 1;
        onProgress?.({
          stage: 'text',
          completed,
          total: pageNumbers.length,
          detail: `读取 PDF 第 ${pageNumber} 页`,
        });
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(PDF_PAGE_CONCURRENCY, pageNumbers.length) },
        nativeWorker,
      ),
    );
    throwIfAborted(signal);

    const needsOcr = nativePages.filter(
      (page) =>
        options.extractMode === 'ocr' ||
        (options.extractMode === 'auto' &&
          page.text.replace(/\s/g, '').length < 80),
    );
    if (!needsOcr.length) {
      return nativePages.map((page) => ({
        ...page,
        method: 'text' as const,
      }));
    }
    if (needsOcr.length > 45) {
      throw new Error('OCR 页数超过 45 页，请缩小页码范围后分批处理。');
    }

    const { createWorker } = await import('tesseract.js');
    throwIfAborted(signal);
    const worker = await createWorker(DEFAULT_OCR_LANGUAGE, undefined, {
      logger: (message) => {
        if (
          message.status === 'recognizing text' &&
          typeof message.progress === 'number'
        ) {
          onProgress?.({
            stage: 'ocr',
            completed: Math.round(message.progress * 100),
            total: 100,
            detail: '正在识别当前页面',
          });
        }
      },
    });
    if (signal.aborted) {
      await worker.terminate();
      throw abortError();
    }
    const abortOcr = () => {
      void worker.terminate();
    };
    signal.addEventListener('abort', abortOcr, { once: true });

    try {
      const ocrPageNumbers = new Set(needsOcr.map((page) => page.page));
      const results: ExtractedPage[] = [];
      let ocrCompleted = 0;

      for (const nativePage of nativePages) {
        throwIfAborted(signal);
        if (!ocrPageNumbers.has(nativePage.page)) {
          results.push({ ...nativePage, method: 'text' });
          continue;
        }

        const page = await pdf.getPage(nativePage.page);
        const canvas = await renderPage(
          page,
          Math.min(Math.max(options.ocrScale, 1), 3),
        );
        throwIfAborted(signal);
        const recognition = await worker.recognize(
          canvas,
          {},
          { blocks: true },
        );
        const regions = ocrRegions(
          recognition.data.blocks as OcrBlock[] | null,
          canvas.width,
          canvas.height,
        );
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        ocrCompleted += 1;
        onProgress?.({
          stage: 'ocr',
          completed: ocrCompleted,
          total: needsOcr.length,
          detail: `OCR 第 ${nativePage.page} 页完成`,
        });
        results.push({
          page: nativePage.page,
          text: recognition.data.text.trim(),
          method: 'ocr',
          confidence: recognition.data.confidence,
          regions,
        });
      }
      return results;
    } finally {
      signal.removeEventListener('abort', abortOcr);
      if (!signal.aborted) await worker.terminate();
    }
  } catch (error) {
    if (signal.aborted) throw abortError();
    throw error;
  } finally {
    signal.removeEventListener('abort', abortLoading);
    if (!signal.aborted) await loadingTask.destroy();
  }
}
