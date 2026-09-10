import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMikiCardPackage } from '../src/mikiCardPackage.ts';
import type { Card } from '../src/types.ts';

const options = { title: '合成测试', sourceKind: 'pdf' as const, fileName: '合成.pdf', packageId: 'synthetic-package', createdAt: '2026-09-10T00:00:00Z' };
const card: Card = { id: 'one', question: '问题', options: '', answer: '答案', point: '', analysis: '', type: '问答', chapter: '第一章', tags: ['复习'], origin: 'manual', reviewStatus: 'approved', sourcePage: 8, sourceQuote: '合成原文' };
test('exports only reviewed content, compatible v1 types and lightweight provenance', () => {
 const payload = JSON.parse(buildMikiCardPackage([card, { ...card, id: 'pending', reviewStatus: 'pending' }, { ...card, id: 'choice', options: 'A. 一\nB. 二' }, { ...card, id: 'cloze', question: '{{c1::填空}}' }], options));
 assert.equal(payload.format, 'miki-card-package');assert.equal(payload.schemaVersion, 1);
 assert.deepEqual(payload.cards.map((c: {type:string}) => c.type), ['qa','choice','cloze']);
 assert.deepEqual(payload.cards[0].provenance, {chapter:'第一章',page:8,quote:'合成原文'});
 assert.equal(payload.source.fileName, '合成.pdf');
 assert.equal('reviewStatus' in payload.cards[0], false);
});
test('does not silently export invalid or excessive cards', () => {
 assert.throws(() => buildMikiCardPackage([card, card], options));
 assert.throws(() => buildMikiCardPackage([{ ...card, answer: '' }], options));
 assert.throws(() => buildMikiCardPackage([{ ...card, question: 'x'.repeat(1201) }], options));
 assert.throws(() => buildMikiCardPackage([{ ...card, reviewStatus: 'pending' }], options));
 assert.throws(() => buildMikiCardPackage(Array.from({length:501}, (_,i) => ({...card,id:String(i)})), options));
 assert.equal(JSON.parse(buildMikiCardPackage(Array.from({length:500}, (_,i) => ({...card,id:String(i)})), options)).cards.length, 500);
});
