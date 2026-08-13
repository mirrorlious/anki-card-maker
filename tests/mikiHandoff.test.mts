import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIKI_CARD_PACKAGE_ACK_TYPE,
  MIKI_CARD_PACKAGE_OFFER_TYPE,
  MIKI_HANDOFF_WINDOW_NAME_PREFIX,
  MIKI_IMPORT_ORIGIN,
  MIKI_IMPORT_URL,
  buildMikiHandoffWindowName,
  encodeMikiHandoffPackage,
  resolveMikiImportTarget,
} from '../src/mikiHandoff.ts';

test('cross-site handoff is pinned to the canonical Miki origin and import route', () => {
  assert.equal(MIKI_IMPORT_ORIGIN, 'https://prom1se.online');
  assert.equal(MIKI_IMPORT_URL, 'https://prom1se.online/import?handoff=card-maker');
  assert.equal(MIKI_CARD_PACKAGE_OFFER_TYPE, 'miki.card-package.offer');
  assert.equal(MIKI_CARD_PACKAGE_ACK_TYPE, 'miki.card-package.ack');
});

test('local card-maker preview hands off to the local Miki preview', () => {
  assert.deepEqual(resolveMikiImportTarget('http://127.0.0.1:4173'), {
    origin: 'http://127.0.0.1:4174',
    url: 'http://127.0.0.1:4174/import?handoff=card-maker',
  });
});

test('builds an identity-free one-shot window payload for opener-isolated browsers', () => {
  const packageData = { packageId: 'pkg-1', cards: [] } as never;
  assert.equal(
    buildMikiHandoffWindowName(packageData),
    `${MIKI_HANDOFF_WINDOW_NAME_PREFIX}${JSON.stringify(packageData)}`,
  );
});

test('encodes unicode card packages for a server-invisible URL fragment', () => {
  const packageData = { packageId: '中文-1', cards: [] } as never;
  const encoded = encodeMikiHandoffPackage(packageData);
  const padded = encoded.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - encoded.length % 4) % 4);
  assert.equal(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))), JSON.stringify(packageData));
});
