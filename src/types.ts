export type ActiveTab = 'upload' | 'text';
export type ParseMode = 'textbook' | 'exam';
export type ExtractMode = 'auto' | 'text' | 'ocr';
export type ExtractMethod = 'text' | 'ocr';

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
}

export interface ExtractedPage {
  page: number;
  text: string;
  method: ExtractMethod;
  confidence?: number;
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
