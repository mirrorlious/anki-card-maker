import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDF_DOCUMENT_ASSETS } from '../pdfAssets';
import type { PdfSourceRect } from '../types';

interface PdfReaderProps {
  file: File;
  focusMode: boolean;
  onPageChange: (page: number) => void;
  onSelectRect: (rect: PdfSourceRect) => void;
  pageNumber: number;
  selectionMode: boolean;
  sourceRects: PdfSourceRect[];
}

interface Point {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rectFromPoints(start: Point, end: Point): PdfSourceRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function canvasLooksBlank(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d');
  if (!context || !canvas.width || !canvas.height) return true;
  const pixels = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  ).data;
  const step = Math.max(
    4,
    Math.floor(Math.min(canvas.width, canvas.height) / 90),
  );
  let sampled = 0;
  let visibleInk = 0;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const index = (y * canvas.width + x) * 4;
      sampled += 1;
      if (
        pixels[index + 3] > 0 &&
        (pixels[index] < 247 ||
          pixels[index + 1] < 247 ||
          pixels[index + 2] < 247)
      ) {
        visibleInk += 1;
      }
    }
  }
  return visibleInk < Math.max(3, sampled * 0.001);
}

export function PdfReader({
  file,
  focusMode,
  onPageChange,
  onSelectRect,
  pageNumber,
  selectionMode,
  sourceRects,
}: PdfReaderProps) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1.2);
  const [renderRevision, setRenderRevision] = useState(0);
  const [blankPage, setBlankPage] = useState(false);
  const [renderedSize, setRenderedSize] = useState({ width: 0, height: 0 });
  const [draftRect, setDraftRect] = useState<PdfSourceRect | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<Point | null>(null);
  const onSelectRectRef = useRef(onSelectRect);
  const selectionModeRef = useRef(selectionMode);
  const maskId = useId().replace(/:/g, '');

  useEffect(() => {
    let active = true;
    let loadingTask:
      | ReturnType<(typeof import('pdfjs-dist'))['getDocument']>
      | undefined;

    void (async () => {
      try {
        setDocument(null);
        setError('');
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        loadingTask = pdfjs.getDocument({
          data: new Uint8Array(await file.arrayBuffer()),
          ...PDF_DOCUMENT_ASSETS,
        });
        const loaded = await loadingTask.promise;
        if (!active) return;
        setDocument(loaded);
      } catch (loadError) {
        if (active) {
          setError(`PDF 阅读器载入失败：${(loadError as Error).message}`);
        }
      }
    })();

    return () => {
      active = false;
      void loadingTask?.destroy();
    };
  }, [file]);

  useEffect(() => {
    if (!document || !canvasRef.current) return;
    let active = true;
    let renderTask: RenderTask | null = null;

    void (async () => {
      try {
        setBlankPage(false);
        const safePage = clamp(pageNumber, 1, document.numPages);
        const page = await document.getPage(safePage);
        if (!active || !canvasRef.current) return;
        const cssViewport = page.getViewport({ scale: zoom });
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const renderViewport = page.getViewport({
          scale: zoom * pixelRatio,
        });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 初始化失败');
        canvas.width = Math.floor(renderViewport.width);
        canvas.height = Math.floor(renderViewport.height);
        canvas.style.width = `${cssViewport.width}px`;
        canvas.style.height = `${cssViewport.height}px`;
        setRenderedSize({
          width: cssViewport.width,
          height: cssViewport.height,
        });
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport: renderViewport,
        });
        await renderTask.promise;
        if (active) setBlankPage(canvasLooksBlank(canvas));
        page.cleanup();
      } catch (renderError) {
        if (
          active &&
          (renderError as Error).name !== 'RenderingCancelledException'
        ) {
          setError(`PDF 页面渲染失败：${(renderError as Error).message}`);
        }
      }
    })();

    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [document, pageNumber, renderRevision, zoom]);

  const pointFromClient = useCallback((clientX: number, clientY: number): Point => {
    const bounds = overlayRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: clamp((clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((clientY - bounds.top) / bounds.height, 0, 1),
    };
  }, []);

  useEffect(() => {
    const moveSelection = (event: PointerEvent) => {
      if (!selectionModeRef.current || !dragStartRef.current) return;
      event.preventDefault();
      setDraftRect(
        rectFromPoints(
          dragStartRef.current,
          pointFromClient(event.clientX, event.clientY),
        ),
      );
    };
    const finishSelection = (event: PointerEvent) => {
      if (!selectionModeRef.current || !dragStartRef.current) return;
      const rect = rectFromPoints(
        dragStartRef.current,
        pointFromClient(event.clientX, event.clientY),
      );
      dragStartRef.current = null;
      setDraftRect(null);
      if (rect.width >= 0.01 && rect.height >= 0.01) {
        onSelectRectRef.current(rect);
      }
    };
    const cancelSelection = () => {
      dragStartRef.current = null;
      setDraftRect(null);
    };
    window.addEventListener('pointermove', moveSelection, { passive: false });
    window.addEventListener('pointerup', finishSelection);
    window.addEventListener('pointercancel', cancelSelection);
    return () => {
      window.removeEventListener('pointermove', moveSelection);
      window.removeEventListener('pointerup', finishSelection);
      window.removeEventListener('pointercancel', cancelSelection);
    };
  }, [pointFromClient]);

  useEffect(() => {
    selectionModeRef.current = selectionMode;
    if (!selectionMode) dragStartRef.current = null;
  }, [selectionMode]);

  useEffect(() => {
    onSelectRectRef.current = onSelectRect;
  }, [onSelectRect]);

  const startSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectionMode) return;
    event.preventDefault();
    const point = pointFromClient(event.clientX, event.clientY);
    dragStartRef.current = point;
    setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; the drag still works inside the page.
    }
  };

  const visibleDraftRect = selectionMode ? draftRect : null;
  const displayedRects = visibleDraftRect
    ? [...sourceRects, visibleDraftRect]
    : sourceRects;
  const totalPages = document?.numPages ?? 0;

  return (
    <div className="flex h-full min-h-[640px] flex-col overflow-hidden rounded-xl border border-violet-100 bg-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-500 bg-violet-600 px-3 py-2 text-white">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, pageNumber - 1))}
            disabled={!document || pageNumber <= 1}
            className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30"
            aria-label="上一页"
          >
            <ChevronLeft size={17} />
          </button>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            第
            <input
              type="number"
              min="1"
              max={totalPages || undefined}
              value={pageNumber}
              onChange={(event) =>
                onPageChange(
                  clamp(
                    Number.parseInt(event.target.value, 10) || 1,
                    1,
                    totalPages || 1,
                  ),
                )
              }
              className="w-16 rounded-md border border-white/15 bg-white/10 px-2 py-1 text-center text-sm text-white"
              aria-label="PDF 页码"
            />
            / {totalPages || '…'} 页
          </label>
          <button
            type="button"
            onClick={() =>
              onPageChange(Math.min(totalPages, pageNumber + 1))
            }
            disabled={!document || pageNumber >= totalPages}
            className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30"
            aria-label="下一页"
          >
            <ChevronRight size={17} />
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((current) => clamp(current - 0.15, 0.6, 2.4))}
            className="rounded-lg p-2 hover:bg-white/10"
            aria-label="缩小 PDF"
          >
            <ZoomOut size={17} />
          </button>
          <span className="w-12 text-center text-xs text-slate-300">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((current) => clamp(current + 0.15, 0.6, 2.4))}
            className="rounded-lg p-2 hover:bg-white/10"
            aria-label="放大 PDF"
          >
            <ZoomIn size={17} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto p-5">
        {!document && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            <LoaderCircle className="mr-2 animate-spin" size={18} />
            正在载入 PDF 阅读器…
          </div>
        )}
        {error && (
          <div className="mx-auto max-w-lg rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}
        {blankPage && !error && (
          <div className="sticky left-1/2 top-3 z-30 mx-auto mb-3 flex w-fit max-w-lg -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 shadow-lg">
            <span>
              当前页渲染为空白。若原页有内容，请尝试重新渲染。
            </span>
            <button
              type="button"
              onClick={() => setRenderRevision((current) => current + 1)}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1.5 font-semibold text-white hover:bg-amber-700"
            >
              <RefreshCw size={13} /> 重试
            </button>
          </div>
        )}
        <div
          className="relative mx-auto bg-white shadow-2xl"
          style={{
            width: renderedSize.width || undefined,
            height: renderedSize.height || undefined,
          }}
        >
          <canvas ref={canvasRef} className="block" />
          <div
            ref={overlayRef}
            data-testid="pdf-source-overlay"
            className={`absolute inset-0 touch-none ${
              selectionMode ? 'cursor-crosshair' : 'pointer-events-none'
            }`}
            onPointerDown={startSelection}
          >
            {selectionMode && (
              <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-violet-600/95 px-4 py-2 text-xs font-semibold text-white shadow-lg">
                按住拖动框选原文，松开后自动保存
              </div>
            )}
            {focusMode && sourceRects.length > 0 && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
              >
                <defs>
                  <mask id={maskId}>
                    <rect width="1" height="1" fill="white" />
                    {sourceRects.map((rect, index) => (
                      <rect
                        key={`${rect.x}-${rect.y}-${index}`}
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                        fill="black"
                      />
                    ))}
                  </mask>
                </defs>
                <rect
                  width="1"
                  height="1"
                  fill="rgba(15, 23, 42, 0.68)"
                  mask={`url(#${maskId})`}
                />
              </svg>
            )}
            {displayedRects.map((rect, index) => (
              <div
                key={`${rect.x}-${rect.y}-${index}`}
                className={`pointer-events-none absolute border-2 ${
                  visibleDraftRect === rect
                    ? 'border-violet-500 bg-violet-300/20'
                    : 'border-amber-500 bg-amber-300/35 shadow-[0_0_0_1px_rgba(255,255,255,0.8)]'
                }`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
