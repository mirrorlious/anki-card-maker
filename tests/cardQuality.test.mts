import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCardQuality } from '../src/cardQuality.ts';
import type { Card } from '../src/types.ts';

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    question: '什么是犯罪构成？',
    options: '',
    answer: '犯罪构成是认定犯罪的法律要件体系。',
    point: '犯罪构成',
    analysis: '',
    type: '名词解释',
    chapter: '刑法',
    tags: [],
    origin: 'local',
    reviewStatus: 'approved',
    ...overrides,
  };
}

test('blocks empty, invalid choice and unverified AI cards from export', () => {
  const cards = [
    card({ id: 'empty', question: '' }),
    card({ id: 'choice', type: '选择题', options: 'A. 甲' }),
    card({
      id: 'ai',
      origin: 'ai',
      sourceQuote: '无法核验的原文',
      tags: ['来源待核'],
    }),
  ];
  const result = evaluateCardQuality(cards);
  assert.deepEqual(result.blockingCardIds, ['empty', 'choice', 'ai']);
  assert.equal(result.exportableCards.length, 0);
  assert.match(result.reports.empty.blockingIssues[0].message, /问题为空/);
});

test('marks later exact duplicates as blocking and conflicting questions as warnings', () => {
  const cards = [
    card({ id: 'first' }),
    card({ id: 'duplicate' }),
    card({ id: 'conflict', answer: '另一种答案。' }),
  ];
  const result = evaluateCardQuality(cards);
  assert.equal(result.reports.first.issues.length, 0);
  assert.equal(result.reports.duplicate.blockingIssues[0].code, 'duplicate_card');
  assert.equal(result.reports.conflict.warningIssues[0].code, 'duplicate_question');
  assert.deepEqual(
    result.exportableCards.map((item) => item.id),
    ['first', 'conflict'],
  );
});

test('only offers source-verified pending AI cards for safe approval', () => {
  const cards = [
    card({
      id: 'ready-ai',
      origin: 'ai',
      reviewStatus: 'pending',
      sourceQuote: '犯罪构成是认定犯罪的法律要件体系。',
    }),
    card({
      id: 'missing-source',
      origin: 'ai',
      reviewStatus: 'pending',
      sourceQuote: '',
      question: '另一个问题？',
    }),
  ];
  const result = evaluateCardQuality(cards);
  assert.deepEqual(result.approvablePendingIds, ['ready-ai']);
  assert.equal(result.exportableCards.length, 0);
});
