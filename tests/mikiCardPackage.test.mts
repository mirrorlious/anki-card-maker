import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMikiCardPackage,
  MIKI_CARD_PACKAGE_FORMAT,
  MIKI_CARD_PACKAGE_MAX_CARDS,
  MIKI_CARD_PACKAGE_SCHEMA_VERSION,
} from '../src/mikiCardPackage.ts';
import type { Card } from '../src/types.ts';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    question: '抵销的效力是什么？',
    options: '',
    answer: '双方债务在同额范围内消灭。',
    point: '抵销',
    analysis: '抵销属于形成权。',
    type: '简答题',
    chapter: '合同编',
    sourcePage: 12,
    tags: ['民法', '民法'],
    origin: 'local',
    reviewStatus: 'approved',
    sourceQuote: '抵销不得附条件或者附期限。',
    confidence: 1.2,
    sourceRects: [{ x: 1, y: 2, width: 3, height: 4 }],
    ...overrides,
  };
}

test('builds deterministic identity-free MikiCardPackage v1 from approved cards', () => {
  const pkg = buildMikiCardPackage({
    cards: [makeCard(), makeCard({ id: 'pending', reviewStatus: 'pending' })],
    title: '民法冲刺',
    sourceFileName: '民法.pdf',
    packageId: 'mcp_test',
    createdAt: '2026-08-13T08:00:00.000Z',
    generatorVersion: '1.0.0',
  });

  assert.equal(pkg.format, MIKI_CARD_PACKAGE_FORMAT);
  assert.equal(pkg.schemaVersion, MIKI_CARD_PACKAGE_SCHEMA_VERSION);
  assert.equal(pkg.cards.length, 1);
  assert.equal(pkg.cards[0].front, '抵销的效力是什么？');
  assert.match(pkg.cards[0].back, /^答案：双方债务/);
  assert.match(pkg.cards[0].back, /考点：抵销/);
  assert.deepEqual(pkg.cards[0].tags, ['民法']);
  assert.equal(pkg.cards[0].provenance?.page, 12);
  assert.equal(pkg.cards[0].provenance?.confidence, 1);
  assert.equal(pkg.source.kind, 'pdf');
  assert.equal(JSON.stringify(pkg).match(/actor|account|token|secret/gi), null);
});

test('maps choices to plain text and bounds package cardinality', () => {
  const cards = Array.from({ length: MIKI_CARD_PACKAGE_MAX_CARDS + 2 }, (_, index) => makeCard({
    id: `choice-${index}`,
    type: '选择题',
    options: 'A. 形成权\nB. 请求权',
  }));
  const pkg = buildMikiCardPackage({ cards, title: '选择题' });

  assert.equal(pkg.cards.length, MIKI_CARD_PACKAGE_MAX_CARDS);
  assert.equal(pkg.cards[0].type, 'choice');
  assert.match(pkg.cards[0].front, /A\. 形成权/);
});

test('fails closed when no approved valid cards remain', () => {
  assert.throws(() => buildMikiCardPackage({
    cards: [makeCard({ reviewStatus: 'pending' })],
    title: '空包',
  }), /没有可导出的已审核卡片/);
});
