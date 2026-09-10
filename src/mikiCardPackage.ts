import type { Card } from './types.ts';

export function buildMikiCardPackage(cards: Card[], {
  title, sourceKind, fileName = '', packageId = crypto.randomUUID(), createdAt = new Date().toISOString(),
}: { title: string; sourceKind: 'text' | 'pdf'; fileName?: string; packageId?: string; createdAt?: string }) {
  const approved = cards.filter((card) => card.reviewStatus === 'approved');
  if (!approved.length || approved.length > 500) throw new Error('每个 Miki 卡片包需包含 1–500 张已审核卡片。');
  const ids = new Set<string>();
  const mapped = approved.map((card) => {
    const front = [card.question, card.options].filter(Boolean).join('\n\n').trim();
    const back = [card.answer, card.point ? `考点：${card.point}` : '', card.analysis ? `解析：${card.analysis}` : ''].filter(Boolean).join('\n\n').trim();
    if (!card.id || card.id.length > 180 || ids.has(card.id) || !front || !back || front.length > 1200 || back.length > 8000 || (front + back).includes('\u0000')) {
      throw new Error('卡片内容无效或超出长度限制，请检查正反面后再导出。');
    }
    ids.add(card.id);
    return {
      id: card.id,
      type: card.options.trim() ? 'choice' : /\{\{c\d+::/.test(front) ? 'cloze' : 'qa',
      front, back,
      tags: [...new Set(card.tags.map((tag) => tag.trim().slice(0, 80)).filter(Boolean))].slice(0, 12),
      provenance: {
        ...(card.chapter ? { chapter: card.chapter.slice(0, 300) } : {}),
        ...(Number.isInteger(card.sourcePage) && card.sourcePage! > 0 ? { page: card.sourcePage } : {}),
        ...(card.sourceQuote ? { quote: card.sourceQuote.slice(0, 1000) } : {}),
      },
    };
  });
  if (!title.trim() || title.length > 300 || !packageId || packageId.length > 180 || Number.isNaN(Date.parse(createdAt))) {
    throw new Error('卡片包标题或导出信息无效。');
  }
  const result = { format: 'miki-card-package', schemaVersion: 1, packageId, title: title.trim(), createdAt,
    generator: { id: 'anki-card-maker', version: '1.0.0' }, source: { kind: sourceKind, fileName: fileName.slice(0, 300) }, cards: mapped };
  const text = JSON.stringify(result, null, 2);
  if (new TextEncoder().encode(text).byteLength > 5 * 1024 * 1024) throw new Error('卡片包超过 5 MiB，请分批导出。');
  return text;
}
