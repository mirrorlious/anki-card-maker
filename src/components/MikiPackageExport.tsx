import { FileJson } from 'lucide-react';
import { useState } from 'react';
import { downloadBlob } from '../exporters';
import { buildMikiCardPackage } from '../mikiCardPackage';
import type { Card } from '../types';

export function MikiPackageExport({ cards, title, fileName, className }: {
  cards: Card[]; title: string; fileName?: string; className: string;
}) {
  const [message, setMessage] = useState('');
  const count = cards.filter((card) => card.reviewStatus === 'approved').length;
  function exportCards() {
    try {
      const text = buildMikiCardPackage(cards, { title, sourceKind: fileName ? 'pdf' : 'text', fileName });
      downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), `${title.slice(0, 40)}_${count}张.miki-cards.json`);
      setMessage('已导出，在 Miki 的智能制卡页选择“导入专业制卡包”。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '导出失败，请检查卡片后重试。'); }
  }
  return <div>
    <button type="button" onClick={exportCards} disabled={!count} className={className}><FileJson size={16} />Miki 卡片包</button>
    {message && <p role="status" className="mt-2 max-w-72 text-sm text-slate-600">{message} <a className="underline" href="https://prom1se.online/import?mode=smart" target="_blank" rel="noopener noreferrer">打开 Miki</a></p>}
  </div>;
}
