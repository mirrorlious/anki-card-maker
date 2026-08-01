import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PARSER_TEMPLATE, createCard } from '../src/parser.ts';
import {
  buildWorkspaceBackup,
  parseWorkspaceBackup,
} from '../src/workspace.ts';
import type { AppSettings } from '../src/types.ts';

const settings: AppSettings = {
  activeTab: 'text',
  parseMode: 'textbook',
  extractMode: 'auto',
  pageStart: '1',
  pageEnd: '30',
  ocrScale: '1.8',
  maxCardsPerPage: '5',
  maxAnswerLength: '220',
  deckName: '测试牌组',
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
    requestTimeout: '45',
    maxRetries: '2',
    useCache: true,
  },
};

test('round-trips a workspace without API secrets', () => {
  const card = createCard({
    question: '问题',
    options: '',
    answer: '答案',
    point: '',
    analysis: '',
    type: '简答题',
    chapter: '',
  });
  const text = buildWorkspaceBackup(
    '原文',
    [card],
    settings,
    [{ page: 1, text: '原文', method: 'text' }],
    123,
  );
  const parsed = parseWorkspaceBackup(text);
  assert.equal(parsed.exportedAt, 123);
  assert.equal(parsed.cards[0].question, '问题');
  assert.equal(parsed.pdfSourcePages[0].page, 1);
  assert.doesNotMatch(text, /apiKey|secret-key|Authorization/);
});

test('rejects malformed or unrelated workspace files', () => {
  assert.throws(() => parseWorkspaceBackup('{bad json'), /有效的 JSON/);
  assert.throws(
    () => parseWorkspaceBackup('{"kind":"other","version":1}'),
    /不是受支持/,
  );
  assert.throws(
    () =>
      parseWorkspaceBackup(
        JSON.stringify({
          kind: 'anki-card-maker-workspace',
          version: 1,
          exportedAt: 1,
          inputText: '',
          cards: [{ id: 'broken' }],
          settings,
          pdfSourcePages: [],
        }),
      ),
    /无效卡片数据/,
  );
});
