import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIKI_CARD_PACKAGE_ACK_TYPE,
  MIKI_CARD_PACKAGE_OFFER_TYPE,
  MIKI_IMPORT_ORIGIN,
  MIKI_IMPORT_URL,
} from '../src/mikiHandoff.ts';

test('cross-site handoff is pinned to the canonical Miki origin and import route', () => {
  assert.equal(MIKI_IMPORT_ORIGIN, 'https://prom1se.online');
  assert.equal(MIKI_IMPORT_URL, 'https://prom1se.online/import?handoff=card-maker');
  assert.equal(MIKI_CARD_PACKAGE_OFFER_TYPE, 'miki.card-package.offer');
  assert.equal(MIKI_CARD_PACKAGE_ACK_TYPE, 'miki.card-package.ack');
});
