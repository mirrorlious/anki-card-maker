import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle,
  Download,
  FileText,
  RefreshCw,
  ScanText,
  Trash2,
  UploadCloud,
} from 'lucide-react';

type ActiveTab = 'upload' | 'text';
type ParseMode = 'textbook' | 'exam';
type ExtractMode = 'auto' | 'text' | 'ocr';
type ExtractMethod = 'text' | 'ocr';

interface Card {
  id: string;
  question: string;
  options: string;
  answer: string;
  point: string;
  analysis: string;
  type: string;
  chapter: string;
  sourcePage?: number;
  tags: string[];
}

interface ExtractedPage {
  page: number;
  text: string;
  method: ExtractMethod;
  confidence?: number;
}

interface TextPage {
  page?: number;
  text: string;
}

declare global {
  interface Window {
    pdfjsLib: any;
    Tesseract?: {
      recognize: (
        image: HTMLCanvasElement,
        language: string,
        options?: { logger?: (message: any) => void },
      ) => Promise<{ data: { text: string; confidence?: number } }>;
    };
  }
}

const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
const PDFJS_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const DEFAULT_OCR_LANGUAGE = 'chi_sim+eng';

const KEYWORD_PATTERNS = [
  /包括|组成|构成|分为|可分为|主要有/,
  /特点|特征|性质|原则|规律/,
  /作用|功能|意义|任务|方法|途径/,
  /影响|原因|条件|机制|过程/,
];

function loadExternalScript(id: string, src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === 'true') {
      resolve();
      return;
    }

    const script = existing ?? document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`脚本加载失败：${src}`));

    if (!existing) document.body.appendChild(script);
  });
}

async function ensurePdfJs() {
  if (!window.pdfjsLib) await loadExternalScript('pdfjs-script', PDFJS_SRC);
  if (!window.pdfjsLib) throw new Error('PDF.js 未加载成功');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
}

async function ensureTesseract() {
  if (!window.Tesseract) await loadExternalScript('tesseract-script', TESSERACT_SRC);
  if (!window.Tesseract) throw new Error('OCR 引擎未加载成功');
}

function clampPage(value: string, fallback: number, max: number) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function textToHtml(value: string) {
  return escapeHtml(value.trim()).replace(/\n/g, '<br>');
}

function normalizeSpaces(value: string) {
  return value
    .replace(/\u3000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanTextbookText(value: string) {
  return normalizeSpaces(value)
    .replace(/香气物联网\s*P?D?G?/g, '')
    .replace(/农业生态学\s*$/gm, '')
    .replace(/^\s*[·•]\s*\d+\s*[·•]?\s*$/gm, '')
    .replace(/^\s*\d+\s*$/gm, '')
    .replace(/-{2,}\s*PAGE\s*\d+\s*-{2,}/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(value: string) {
  return value
    .replace(/([。！？；])/g, '$1\n')
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length >= 18);
}

function isChapterLine(line: string) {
  return /^第[一二三四五六七八九十百千\d]+章\s*.{0,50}$/.test(line.trim());
}

function isSectionLine(line: string) {
  return /^第[一二三四五六七八九十百千\d]+节\s*.{0,50}$/.test(line.trim());
}

function isHeadingLine(line: string) {
  const trimmed = line.trim();
  if (trimmed.length > 42) return false;
  return /^(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+[.、])\s*\S+/.test(trimmed);
}

function slimAnswer(value: string, maxLength: number) {
  const compact = normalizeSpaces(value).replace(/\n+/g, '\n');
  if (compact.length <= maxLength) return compact;
  const sliced = compact.slice(0, maxLength);
  const lastStop = Math.max(sliced.lastIndexOf('。'), sliced.lastIndexOf('；'), sliced.lastIndexOf('，'));
  return `${sliced.slice(0, lastStop > 80 ? lastStop + 1 : maxLength)}……`;
}

function makeCard(input: Omit<Card, 'id' | 'tags'> & { tags?: string[] }) {
  return {
    ...input,
    id: crypto.randomUUID(),
    tags: input.tags ?? [],
  };
}

function buildFront(card: Card) {
  return card.options
    ? `${textToHtml(card.question)}<br><br>${textToHtml(card.options)}`
    : textToHtml(card.question);
}

function buildBack(card: Card) {
  const meta = [card.chapter, card.sourcePage ? `PDF 第 ${card.sourcePage} 页` : '', card.type]
    .filter(Boolean)
    .join(' ｜ ');

  const parts = [`<b>答案：</b><br>${textToHtml(card.answer)}`];
  if (card.point) parts.push(`<b>考点：</b>${textToHtml(card.point)}`);
  if (card.analysis) parts.push(`<b>解析：</b><br>${textToHtml(card.analysis)}`);
  if (meta) parts.push(`<span style="color:#666;font-size:12px">${textToHtml(meta)}</span>`);
  return parts.join('<br><br>');
}

function buildTextFromPdfItems(items: Array<{ str: string; transform?: number[] }>) {
  let text = '';
  let lastY: number | null = null;

  items.forEach((item) => {
    const y = Math.round(item.transform?.[5] ?? 0);
    if (lastY !== null && Math.abs(y - lastY) > 6) text += '\n';
    else if (text && !text.endsWith('\n')) text += ' ';
    text += item.str;
    lastY = y;
  });

  return normalizeSpaces(text);
}

function buildTextbookCards(pages: TextPage[], maxAnswerLength: number, maxCardsPerPage: number) {
  const cards: Card[] = [];
  const seen = new Set<string>();
  let currentChapter = '未识别章节';
  let currentHeading = '';

  const push = (card: Omit<Card, 'id' | 'tags'> & { tags?: string[] }) => {
    const key = `${card.question}|${card.answer.slice(0, 30)}`;
    if (seen.has(key)) return;
    if (card.question.length < 6 || card.answer.length < 14) return;
    seen.add(key);
    cards.push(makeCard(card));
  };

  pages.forEach((page) => {
    const sourcePage = page.page;
    const text = cleanTextbookText(page.text);
    if (!text) return;

    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const pageStartCount = cards.length;
    const paragraphs: string[] = [];
    let buffer = '';

    lines.forEach((line) => {
      if (isChapterLine(line)) {
        currentChapter = line;
        currentHeading = '';
        return;
      }
      if (isSectionLine(line) || isHeadingLine(line)) {
        if (buffer) {
          paragraphs.push(buffer);
          buffer = '';
        }
        currentHeading = line.replace(/^(?:[一二三四五六七八九十]+、|（[一二三四五六七八九十]+）|\d+[.、])\s*/, '');
        return;
      }

      buffer += buffer ? line : line;
      if (/[。！？；]$/.test(line) || buffer.length >= 220) {
        paragraphs.push(buffer);
        buffer = '';
      }
    });

    if (buffer) paragraphs.push(buffer);

    paragraphs.forEach((paragraph) => {
      if (cards.length - pageStartCount >= maxCardsPerPage) return;
      const sentences = splitSentences(paragraph);
      const joined = slimAnswer(sentences.slice(0, 3).join(''), maxAnswerLength);
      const chapter = currentChapter;
      const topic = currentHeading || chapter.replace(/^第[一二三四五六七八九十百千\d]+章\s*/, '') || '本节内容';

      const definitionMatch = paragraph.match(/([\u4e00-\u9fa5A-Za-z0-9（）()·—-]{2,22})(?:是指|是|指)([^。！？；]{18,220}[。！？；]?)/);
      if (definitionMatch) {
        const term = definitionMatch[1]
          .replace(/^[的地得和与及其这种一个一种]+/, '')
          .replace(/[，。；：:、]/g, '')
          .trim();
        const definition = slimAnswer(`${term}${paragraph.includes('是指') ? '是指' : paragraph.includes('指') ? '指' : '是'}${definitionMatch[2]}`, maxAnswerLength);
        if (term.length >= 2 && term.length <= 18) {
          push({
            question: `什么是${term}？`,
            options: '',
            answer: definition,
            point: topic,
            analysis: '由教材正文自动抽取定义句，建议预览后保留或精修。',
            type: '名词解释',
            chapter,
            sourcePage,
            tags: ['教材OCR', '名词解释', chapter],
          });
        }
      }

      if (cards.length - pageStartCount >= maxCardsPerPage) return;
      const hasKeyword = KEYWORD_PATTERNS.some((pattern) => pattern.test(paragraph));
      if (hasKeyword && joined.length >= 35) {
        const questionPrefix = /包括|组成|构成|分为|可分为|主要有/.test(paragraph)
          ? '简述其组成或分类。'
          : /作用|功能|意义|任务|方法|途径/.test(paragraph)
            ? '简述其作用、意义或方法。'
            : '简述教材中的核心要点。';
        push({
          question: `${topic}：${questionPrefix}`,
          options: '',
          answer: joined,
          point: topic,
          analysis: '命中“组成/特点/作用/影响”等高频考点词后自动生成。',
          type: '简答题',
          chapter,
          sourcePage,
          tags: ['教材OCR', '简答', chapter],
        });
      }

      if (cards.length - pageStartCount >= maxCardsPerPage) return;
      const fillSentence = sentences.find((sentence) => /是|包括|分为|具有/.test(sentence) && sentence.length <= 120);
      if (fillSentence) {
        const fillTerm = definitionMatch?.[1]?.replace(/[，。；：:、]/g, '').trim() || topic.slice(0, 12);
        if (fillTerm.length >= 2) {
          push({
            question: fillSentence.replace(fillTerm, '____'),
            options: '',
            answer: fillTerm,
            point: topic,
            analysis: fillSentence,
            type: '填空题',
            chapter,
            sourcePage,
            tags: ['教材OCR', '填空', chapter],
          });
        }
      }
    });
  });

  return cards;
}

function parseExamCards(text: string) {
  let cleanText = text
    .replace(/关注小 Red 书@刑法于越.*?\n/g, '')
    .replace(/--- PAGE \d+ ---\n?/g, '')
    .replace(/\r/g, '');

  cleanText = `\n${cleanText}`;
  const blocks = cleanText.split(/\n(?=\d+\s*-\s*\d+(?:\s*-\s*\d+)?\s)/);
  const extractedCards: Card[] = [];
  const sectionEndRegex = /\n\s*(?:>\s*)?【\s*(?:拓\s*展|子\s*题|小\s*结|命\s*题\s*角\s*度)/;

  blocks.forEach((block) => {
    if (!block.trim()) return;

    const qMatch = block.match(/^(\d+\s*-\s*\d+(?:\s*-\s*\d+)?\s.*?)(?=\n\s*[A-D][.、]|【\s*答\s*案\s*】|答\s*案\s*[:：])/s);
    const optMatch = block.match(/(\n\s*[A-D][.、].*?)(?=【\s*答\s*案\s*】|答\s*案\s*[:：])/s);
    const ansMatch = block.match(/(?:【\s*答\s*案\s*】|答\s*案\s*[:：])\s*([A-D]+)/i);
    const ptMatch = block.match(/(?:【\s*考\s*点\s*】|考\s*点\s*[:：])\s*(.*?)(?=\n\s*【|\n\s*解\s*析|$)/s);

    if (!qMatch || !ansMatch) return;

    const question = qMatch[1].trim().replace(/\n/g, '');
    const options = optMatch ? optMatch[1].trim().replace(/\n/g, '\n') : '';
    const answer = ansMatch[1].trim().toUpperCase();
    const point = ptMatch ? ptMatch[1].trim().replace(/\n/g, '') : '';
    let analysis = '';

    const anaMatch = block.match(/(?:【\s*解\s*析\s*】|解\s*析\s*[:：])\s*(.*?)(?=\n\s*(?:>\s*)?【\s*(?:拓\s*展|子\s*题|小\s*结|命\s*题\s*角\s*度)|$)/s);
    if (anaMatch && anaMatch[1].trim()) {
      analysis = anaMatch[1].trim();
    } else if (ptMatch) {
      const afterPointIdx = block.indexOf(ptMatch[0]) + ptMatch[0].length;
      const afterPoint = block.substring(afterPointIdx).trim().replace(/^[【\[]?\s*解\s*析\s*[】\]]?[：:]?\s*/, '');
      analysis = afterPoint.split(sectionEndRegex)[0].trim();
    } else {
      const afterAnsIdx = block.indexOf(ansMatch[0]) + ansMatch[0].length;
      const afterAns = block.substring(afterAnsIdx).trim().replace(/^[【\[]?\s*解\s*析\s*[】\]]?[：:]?\s*/, '');
      analysis = afterAns.split(sectionEndRegex)[0].trim();
    }

    extractedCards.push(
      makeCard({
        question,
        options,
        answer,
        point,
        analysis,
        type: '选择题',
        chapter: '刑法母子题',
        tags: ['刑法', '选择题', point].filter(Boolean),
      }),
    );
  });

  return extractedCards;
}

export default function App() {
  const [inputText, setInputText] = useState('');
  const [cards, setCards] = useState<Card[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('upload');
  const [parseMode, setParseMode] = useState<ParseMode>('textbook');
  const [extractMode, setExtractMode] = useState<ExtractMode>('auto');
  const [pageStart, setPageStart] = useState('20');
  const [pageEnd, setPageEnd] = useState('37');
  const [ocrScale, setOcrScale] = useState('1.6');
  const [maxCardsPerPage, setMaxCardsPerPage] = useState('5');
  const [maxAnswerLength, setMaxAnswerLength] = useState('220');
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ensurePdfJs().catch(() => {
      setErrorMsg('PDF 解析脚本预加载失败。稍后上传时会再次尝试加载。');
    });
  }, []);

  const processText = (text: string) => {
    setIsProcessing(true);
    setErrorMsg('');
    setStatusMsg('正在生成卡片...');

    try {
      const generated = parseMode === 'exam'
        ? parseExamCards(text)
        : buildTextbookCards(
            [{ text }],
            Number.parseInt(maxAnswerLength, 10) || 220,
            Number.parseInt(maxCardsPerPage, 10) || 5,
          );

      setCards(generated);
      if (generated.length === 0) {
        setErrorMsg(parseMode === 'exam'
          ? '未识别到符合“题干/选项/答案/解析”结构的题目，请检查文本格式。'
          : '暂未生成卡片。建议换正文页、开启 OCR，或把页码范围缩小到具体章节。');
      }
      setStatusMsg(`完成：生成 ${generated.length} 张卡片。`);
    } catch (err) {
      setErrorMsg(`解析出错：${(err as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const ocrPage = async (page: any, pageNumber: number, totalSelectedPages: number) => {
    await ensureTesseract();
    const scale = Number.parseFloat(ocrScale) || 1.6;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 初始化失败');

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: context, viewport }).promise;

    const result = await window.Tesseract!.recognize(canvas, DEFAULT_OCR_LANGUAGE, {
      logger: (message) => {
        if (message?.status === 'recognizing text' && typeof message.progress === 'number') {
          setStatusMsg(`OCR 第 ${pageNumber}/${totalSelectedPages} 页：${Math.round(message.progress * 100)}%`);
        }
      },
    });

    canvas.width = 0;
    canvas.height = 0;
    return {
      text: normalizeSpaces(result.data.text || ''),
      confidence: result.data.confidence,
    };
  };

  const extractPdfPages = async (file: File) => {
    await ensurePdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const start = clampPage(pageStart, 1, pdf.numPages);
    const end = clampPage(pageEnd, Math.min(start + 17, pdf.numPages), pdf.numPages);
    const safeStart = Math.min(start, end);
    const safeEnd = Math.max(start, end);
    const totalSelectedPages = safeEnd - safeStart + 1;

    if (extractMode !== 'text' && totalSelectedPages > 45) {
      throw new Error('OCR 很慢，建议一次处理 10–30 页。请先缩小页码范围，生成稳定后再分章处理。');
    }

    const extractedPages: ExtractedPage[] = [];

    for (let pageNumber = safeStart; pageNumber <= safeEnd; pageNumber += 1) {
      setStatusMsg(`读取 PDF 第 ${pageNumber}/${safeEnd} 页...`);
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const nativeText = buildTextFromPdfItems(textContent.items);
      const shouldUseOcr = extractMode === 'ocr' || (extractMode === 'auto' && nativeText.replace(/\s/g, '').length < 80);

      if (!shouldUseOcr) {
        extractedPages.push({ page: pageNumber, text: nativeText, method: 'text' });
        continue;
      }

      const ocrResult = await ocrPage(page, pageNumber - safeStart + 1, totalSelectedPages);
      extractedPages.push({
        page: pageNumber,
        text: ocrResult.text,
        method: 'ocr',
        confidence: ocrResult.confidence,
      });
    }

    return extractedPages;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setErrorMsg('请上传 PDF 格式文件');
      return;
    }

    setIsProcessing(true);
    setErrorMsg('');
    setStatusMsg('准备读取 PDF...');
    setCards([]);

    try {
      const extractedPages = await extractPdfPages(file);
      const fullText = extractedPages
        .map((page) => `--- PAGE ${page.page} [${page.method}] ---\n${page.text}`)
        .join('\n\n');
      setInputText(fullText);

      const generated = parseMode === 'exam'
        ? parseExamCards(fullText)
        : buildTextbookCards(
            extractedPages,
            Number.parseInt(maxAnswerLength, 10) || 220,
            Number.parseInt(maxCardsPerPage, 10) || 5,
          );

      setCards(generated);
      const ocrCount = extractedPages.filter((page) => page.method === 'ocr').length;
      const textCount = extractedPages.length - ocrCount;
      setStatusMsg(`完成：读取 ${extractedPages.length} 页（OCR ${ocrCount} 页，文本 ${textCount} 页），生成 ${generated.length} 张卡片。`);

      if (generated.length === 0) {
        setErrorMsg('已读取 PDF，但没有生成卡片。建议切到“教材背诵卡”、选择正文页，并开启 OCR。');
      }
    } catch (err) {
      setErrorMsg(`PDF 处理失败：${(err as Error).message}`);
      setStatusMsg('');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateCard = (id: string, field: 'question' | 'answer' | 'point' | 'analysis', value: string) => {
    setCards((current) => current.map((card) => (card.id === id ? { ...card, [field]: value } : card)));
  };

  const removeCard = (id: string) => {
    setCards((current) => current.filter((card) => card.id !== id));
  };

  const exportToAnki = () => {
    if (cards.length === 0) return;

    const content = cards.map((card) => `${buildFront(card)}\t${buildBack(card)}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filePrefix = parseMode === 'exam' ? 'Anki_题库解析' : 'Anki_教材背诵卡';

    a.href = url;
    a.download = `${filePrefix}_${cards.length}张.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportToJson = () => {
    if (cards.length === 0) return;

    const payload = cards.map((card) => ({
      ...card,
      front: buildFront(card),
      back: buildBack(card),
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = `cards_${cards.length}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 text-emerald-700 px-3 py-1 text-xs font-semibold">
              <ScanText size={14} /> OCR 教材制卡版
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-950 tracking-tight">Anki 批量制卡引擎</h1>
              <p className="text-slate-500 text-sm mt-1">支持扫描版教材 PDF：OCR 识别、章节切块、自动生成名词解释/简答/填空卡。</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={exportToJson}
              disabled={cards.length === 0}
              className="flex items-center gap-2 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-slate-700 px-4 py-2.5 rounded-xl font-medium border border-slate-200 transition-all active:scale-95"
            >
              <FileText size={18} /> 导出 JSON
            </button>
            <button
              onClick={exportToAnki}
              disabled={cards.length === 0}
              className="flex items-center gap-2 bg-slate-950 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-sm active:scale-95"
            >
              <Download size={18} /> 导出 {cards.length} 张 Anki 卡
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-6">
          <aside className="space-y-4">
            <section className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="flex border-b border-slate-100">
                <button
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'upload' ? 'bg-emerald-50 text-emerald-700 border-b-2 border-emerald-600' : 'text-slate-500 hover:bg-slate-50'}`}
                  onClick={() => setActiveTab('upload')}
                >
                  PDF 上传
                </button>
                <button
                  className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'text' ? 'bg-emerald-50 text-emerald-700 border-b-2 border-emerald-600' : 'text-slate-500 hover:bg-slate-50'}`}
                  onClick={() => setActiveTab('text')}
                >
                  文本粘贴
                </button>
              </div>

              <div className="p-5 space-y-5">
                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                  <button
                    onClick={() => setParseMode('textbook')}
                    className={`rounded-xl py-2 text-sm font-semibold transition ${parseMode === 'textbook' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                  >
                    教材背诵卡
                  </button>
                  <button
                    onClick={() => setParseMode('exam')}
                    className={`rounded-xl py-2 text-sm font-semibold transition ${parseMode === 'exam' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
                  >
                    题库解析卡
                  </button>
                </div>

                {activeTab === 'upload' ? (
                  <div className="space-y-4">
                    <div
                      className="border-2 border-dashed border-slate-200 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:bg-slate-50 hover:border-emerald-300 transition-colors cursor-pointer"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                      />
                      <UploadCloud className="w-10 h-10 text-slate-400 mb-3" />
                      <p className="text-sm font-semibold text-slate-700">点击上传 PDF</p>
                      <p className="text-xs text-slate-500 mt-1">扫描版会自动走 OCR，建议先按章处理。</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-medium text-slate-500 space-y-1">
                        起始页
                        <input
                          value={pageStart}
                          onChange={(event) => setPageStart(event.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </label>
                      <label className="text-xs font-medium text-slate-500 space-y-1">
                        结束页
                        <input
                          value={pageEnd}
                          onChange={(event) => setPageEnd(event.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-medium text-slate-500 space-y-1">
                        识别方式
                        <select
                          value={extractMode}
                          onChange={(event) => setExtractMode(event.target.value as ExtractMode)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          <option value="auto">自动判断</option>
                          <option value="ocr">强制 OCR</option>
                          <option value="text">仅提取文本</option>
                        </select>
                      </label>
                      <label className="text-xs font-medium text-slate-500 space-y-1">
                        OCR 清晰度
                        <input
                          value={ocrScale}
                          onChange={(event) => setOcrScale(event.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <textarea
                      className="w-full h-64 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none resize-none"
                      placeholder={parseMode === 'textbook' ? '粘贴教材正文，系统会生成名词解释/简答/填空卡...' : '粘贴题库文本，要求包含题干、选项、答案、解析...'}
                      value={inputText}
                      onChange={(event) => setInputText(event.target.value)}
                    />
                    <button
                      onClick={() => processText(inputText)}
                      disabled={!inputText.trim() || isProcessing}
                      className="w-full flex items-center justify-center gap-2 bg-slate-950 hover:bg-slate-800 disabled:bg-slate-300 text-white py-3 rounded-xl font-medium transition-colors"
                    >
                      {isProcessing ? <RefreshCw className="animate-spin w-5 h-5" /> : <BookOpen className="w-5 h-5" />}
                      {isProcessing ? '处理中...' : '开始制卡'}
                    </button>
                  </div>
                )}

                {parseMode === 'textbook' && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-slate-500 space-y-1">
                      每页最多卡片
                      <input
                        value={maxCardsPerPage}
                        onChange={(event) => setMaxCardsPerPage(event.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-500 space-y-1">
                      答案最长字数
                      <input
                        value={maxAnswerLength}
                        onChange={(event) => setMaxAnswerLength(event.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </label>
                  </div>
                )}

                {statusMsg && (
                  <div className="p-3 bg-emerald-50 text-emerald-700 text-sm rounded-xl flex items-start gap-2">
                    {isProcessing ? <RefreshCw className="w-5 h-5 flex-shrink-0 mt-0.5 animate-spin" /> : <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                    <span>{statusMsg}</span>
                  </div>
                )}

                {errorMsg && (
                  <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}
              </div>
            </section>

            <section className="bg-emerald-50/70 p-5 rounded-3xl border border-emerald-100 text-sm text-emerald-900">
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <CheckCircle size={16} /> 使用建议
              </h3>
              <ul className="space-y-1.5 list-disc list-inside opacity-90">
                <li>扫描版教材优先选“强制 OCR”。</li>
                <li>一次处理 10–30 页更稳，别直接整本 300 页。</li>
                <li>先预览删改，再导出 Anki TXT。</li>
                <li>Anki 导入时分隔符选 Tab，并允许 HTML。</li>
              </ul>
            </section>
          </aside>

          <main className="bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col min-h-[820px] overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col gap-3 md:flex-row md:items-center md:justify-between bg-slate-50/70">
              <div>
                <h2 className="font-bold text-slate-900">卡片预览与微调</h2>
                <p className="text-sm text-slate-500 mt-1">可以直接修改问题、答案、考点和解析，再导出。</p>
              </div>
              <span className="text-sm font-semibold bg-slate-200 text-slate-700 px-3 py-1 rounded-full self-start md:self-auto">
                共 {cards.length} 张
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {cards.length === 0 ? (
                <div className="h-full min-h-[620px] flex flex-col items-center justify-center text-slate-400 text-center px-8">
                  <FileText className="w-16 h-16 mb-4 opacity-20" />
                  <p className="font-medium text-slate-500">暂无卡片</p>
                  <p className="text-sm mt-2 max-w-md">上传扫描版教材 PDF 后，系统会先 OCR，再自动抽取定义句、高频考点句和填空句。</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {cards.map((card, index) => (
                    <article key={card.id} className="group border border-slate-200 rounded-2xl p-5 hover:shadow-md transition-shadow bg-white relative">
                      <button
                        onClick={() => removeCard(card.id)}
                        className="absolute top-4 right-4 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="删除此卡片"
                      >
                        <Trash2 size={18} />
                      </button>

                      <div className="flex flex-wrap items-center gap-2 mb-4 pr-8">
                        <span className="inline-flex bg-slate-950 text-white text-xs font-bold px-2.5 py-1 rounded-full">{index + 1}</span>
                        <span className="inline-flex bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-full">{card.type}</span>
                        {card.sourcePage && <span className="inline-flex bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-1 rounded-full">PDF 第 {card.sourcePage} 页</span>}
                        {card.chapter && <span className="inline-flex bg-slate-100 text-slate-600 text-xs font-medium px-2.5 py-1 rounded-full">{card.chapter}</span>}
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <label className="space-y-2">
                          <span className="text-xs font-semibold text-slate-500">问题</span>
                          <textarea
                            value={card.question}
                            onChange={(event) => updateCard(card.id, 'question', event.target.value)}
                            className="w-full min-h-24 rounded-2xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-900 leading-relaxed outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-semibold text-slate-500">答案</span>
                          <textarea
                            value={card.answer}
                            onChange={(event) => updateCard(card.id, 'answer', event.target.value)}
                            className="w-full min-h-24 rounded-2xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-900 leading-relaxed outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
                          />
                        </label>
                      </div>

                      {(card.point || card.analysis) && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                          <label className="space-y-2">
                            <span className="text-xs font-semibold text-slate-500">考点</span>
                            <input
                              value={card.point}
                              onChange={(event) => updateCard(card.id, 'point', event.target.value)}
                              className="w-full rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs font-semibold text-slate-500">解析/来源说明</span>
                            <input
                              value={card.analysis}
                              onChange={(event) => updateCard(card.id, 'analysis', event.target.value)}
                              className="w-full rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                            />
                          </label>
                        </div>
                      )}
                    </article>
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
