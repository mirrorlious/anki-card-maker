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
    question: '?????????',
    options: '',
    answer: '?????????????',
    point: '??',
    analysis: '????????',
    type: '???',
    chapter: '???',
    sourcePage: 12,
    tags: ['??', '??'],
    origin: 'local',
    reviewStatus: 'approved',
    sourceQuote: '?????????????',
    confidence: 1.2,
    sourceRects: [{ x: 1, y: 2, width: 3, height: 4 }],
    ...overrides,
  };
}

test('builds deterministic identity-free MikiCardPackage v1 from approved cards', () => {
  const pkg = buildMikiCardPackage({
    cards: [makeCard(), makeCard({ id: 'pending', reviewStatus: 'pending' })],
    title: '????',
    sourceFileName: '??.pdf',
    packageId: 'mcp_test',
    createdAt: '2026-08-13T08:00:00.000Z',
    generatorVersion: '1.0.0',
  });

  assert.equal(pkg.format, MIKI_CARD_PACKAGE_FORMAT);
  assert.equal(pkg.schemaVersion, MIKI_CARD_PACKAGE_SCHEMA_VERSION);
  assert.equal(pkg.cards.length, 1);
  assert.equal(pkg.cards[0].front, '?????????');
  assert.match(pkg.cards[0].back, /^???????/);
  assert.match(pkg.cards[0].back, /?????/);
  assert.deepEqual(pkg.cards[0].tags, ['??']);
  assert.equal(pkg.cards[0].provenance?.page, 12);
  assert.equal(pkg.cards[0].provenance?.confidence, 1);
  assert.equal(pkg.source.kind, 'pdf');
  assert.equal(JSON.stringify(pkg).match(/actor|account|token|secret/gi), null);
});

test('maps choices to plain text and bounds package cardinality', () => {
  const cards = Array.from({ length: MIKI_CARD_PACKAGE_MAX_CARDS + 2 }, (_, index) => makeCard({
    id: `choice-${index}`,
    type: '???',
    options: 'A. ???\nB. ???',
  }));
  const pkg = buildMikiCardPackage({ cards, title: '???' });

  assert.equal(pkg.cards.length, MIKI_CARD_PACKAGE_MAX_CARDS);
  assert.equal(pkg.cards[0].type, 'choice');
  assert.match(pkg.cards[0].front, /A\. ???/);
});

test('fails closed when no approved valid cards remain', () => {
  assert.throws(() => buildMikiCardPackage({
    cards: [makeCard({ reviewStatus: 'pending' })],
    title: '??',
  }), /???????????/);
});
