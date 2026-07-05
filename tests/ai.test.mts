import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateCardsWithAi,
  resolveChatEndpoint,
  splitTextForAi,
  testAiConnection,
} from '../src/ai.ts';
import type { AiSettings } from '../src/types.ts';

const settings: AiSettings = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  jsonMode: true,
  chunkSize: '1000',
  maxChunks: '2',
  cardsPerChunk: '4',
  customInstructions: '',
};

test('resolves OpenAI-compatible chat completion endpoints', () => {
  assert.equal(
    resolveChatEndpoint('https://api.deepseek.com/'),
    'https://api.deepseek.com/chat/completions',
  );
  assert.equal(
    resolveChatEndpoint('http://localhost:11434/v1/chat/completions'),
    'http://localhost:11434/v1/chat/completions',
  );
  assert.throws(() => resolveChatEndpoint('file:///secret'), /HTTP/);
});

test('splits long source text without losing paragraphs', () => {
  const chunks = splitTextForAi(
    `${'第一段。'.repeat(180)}\n\n${'第二段。'.repeat(180)}`,
    1000,
  );
  assert.equal(chunks.length, 2);
  assert.match(chunks[0], /第一段/);
  assert.match(chunks[1], /第二段/);
});

test('generates pending AI candidates and verifies source quotes', async () => {
  const requests: Array<{ url: string; authorization: string; body: string }> =
    [];
  const mockFetch: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('Authorization') ?? '',
      body: String(init?.body),
    });
    return new Response(
      JSON.stringify({
        model: 'deepseek-v4-flash',
        usage: { prompt_tokens: 120, completion_tokens: 80 },
        choices: [
          {
            message: {
              content: JSON.stringify({
                cards: [
                  {
                    question: '什么是犯罪构成？',
                    answer: '犯罪构成是认定犯罪的法律要件体系。',
                    type: '名词解释',
                    tags: ['刑法'],
                    sourceQuote: '犯罪构成是认定犯罪的法律要件体系。',
                    confidence: 0.95,
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const result = await generateCardsWithAi(
    '犯罪构成是认定犯罪的法律要件体系。',
    { ...settings, apiKey: 'secret-key' },
    {
      signal: new AbortController().signal,
      fetchImpl: mockFetch,
    },
  );

  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].origin, 'ai');
  assert.equal(result.cards[0].reviewStatus, 'pending');
  assert.equal(result.cards[0].confidence, 0.95);
  assert.equal(result.usage.promptTokens, 120);
  assert.equal(requests[0].authorization, 'Bearer secret-key');
  assert.equal(
    requests[0].url,
    'https://api.deepseek.com/chat/completions',
  );
  assert.match(requests[0].body, /json_object/);
});

test('tests a custom connection using Chat Completions JSON', async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        model: 'custom-model',
        choices: [{ message: { content: '{"status":"ok"}' } }],
      }),
      { status: 200 },
    );
  const model = await testAiConnection(
    {
      ...settings,
      provider: 'custom',
      baseUrl: 'https://example.com/v1',
      model: 'custom-model',
      apiKey: '',
    },
    new AbortController().signal,
    mockFetch,
  );

  assert.equal(model, 'custom-model');
});
