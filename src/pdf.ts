import {
  getDocument,
  GlobalWorkerOptions,
  type PDFPageProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  ExtractedPage,
  ExtractMode,
  PdfProgress,
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
  text: string;
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

async function extractNativeText(page: PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent();
  let result = '';
  let previous:
    | { endX: number; fontSize: number; text: string; y: number }
    | undefined;

  for (const item of textContent.items) {
    if (!('str' in item)) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const fontSize =
      Math.hypot(item.transform[2], item.transform[3]) || item.height || 10;

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
  return result.trim();
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

  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
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
        nativePages[index] = {
          page: pageNumber,
          text: await extractNativeText(page),
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
        const recognition = await worker.recognize(canvas);
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
