export type ActiveTab = 'upload' | 'text';
export type ParseMode = 'textbook' | 'exam';
export type ExtractMode = 'auto' | 'text' | 'ocr';
export type ExtractMethod = 'text' | 'ocr';
export type CardOrigin = 'local' | 'ai' | 'manual';
export type ReviewStatus = 'pending' | 'approved';

export interface Card {
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
  origin: CardOrigin;
  reviewStatus: ReviewStatus;
  sourceQuote?: string;
  confidence?: number;
  sourceRects?: PdfSourceRect[];
}

export interface PdfSourceRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface SourceTextRegion extends PdfSourceRect {
  text: string;
}

export interface ExtractedPage {
  page: number;
  text: string;
  method: ExtractMethod;
  confidence?: number;
  regions?: SourceTextRegion[];
}

export interface TextPage {
  page?: number;
  text: string;
}

export interface ParserTemplate {
  id: string;
  name: string;
  questionPattern: string;
  optionLetters: string;
  answerLabels: string[];
  pointLabels: string[];
  analysisLabels: string[];
  trailingLabels: string[];
}

export interface AppSettings {
  activeTab: ActiveTab;
  parseMode: ParseMode;
  extractMode: ExtractMode;
  pageStart: string;
  pageEnd: string;
  ocrScale: string;
  maxCardsPerPage: string;
  maxAnswerLength: string;
  deckName: string;
  parserTemplate: ParserTemplate;
  ai: AiSettings;
}

export interface AiSettings {
  provider: 'deepseek' | 'custom' | 'ollama';
  baseUrl: string;
  model: string;
  jsonMode: boolean;
  chunkSize: string;
  maxChunks: string;
  cardsPerChunk: string;
  customInstructions: string;
  requestTimeout: string;
  maxRetries: string;
  useCache: boolean;
}

export interface DraftData {
  version: 1;
  inputText: string;
  cards: Card[];
  settings: AppSettings;
  savedAt: number;
}

export interface PdfProgress {
  stage: 'loading' | 'text' | 'ocr';
  completed: number;
  total: number;
  detail?: string;
}

export interface ParseResult {
  cards: Card[];
  candidateCount: number;
  skippedCount: number;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AiGenerationResult {
  cards: Card[];
  usage: AiUsage;
  processedChunks: number;
  skippedChunks: number;
  retriedRequests: number;
  failedChunks: AiChunkFailure[];
  fromCache?: boolean;
}

export interface AiProgress {
  completed: number;
  total: number;
  detail: string;
  stage?: 'preparing' | 'requesting' | 'retrying' | 'parsing' | 'completed';
  attempt?: number;
  maxAttempts?: number;
}

export interface AiChunkFailure {
  chunk: number;
  message: string;
}
