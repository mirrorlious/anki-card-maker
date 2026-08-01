import { AlertTriangle, MapPin, ShieldAlert, Trash2 } from 'lucide-react';
import type { CardQualityIssue } from '../cardQuality';
import type { Card } from '../types';

export type EditableCardField =
  | 'question'
  | 'options'
  | 'answer'
  | 'point'
  | 'analysis'
  | 'type'
  | 'chapter'
  | 'tags';

interface CardEditorProps {
  card: Card;
  index: number;
  qualityIssues?: CardQualityIssue[];
  selected: boolean;
  onDelete: (id: string) => void;
  onOpenSource?: (id: string) => void;
  onApprove: (id: string) => void;
  onToggle: (id: string) => void;
  onUpdate: (
    id: string,
    field: EditableCardField,
    value: string | string[],
  ) => void;
}

const fieldClass =
  'w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm leading-relaxed text-slate-900 outline-none transition focus:border-transparent focus:ring-2 focus:ring-violet-500';

export function CardEditor({
  card,
  index,
  qualityIssues = [],
  selected,
  onDelete,
  onOpenSource,
  onApprove,
  onToggle,
  onUpdate,
}: CardEditorProps) {
  const hasBlockingIssue = qualityIssues.some(
    (item) => item.severity === 'blocking',
  );
  return (
    <article
      className={`relative rounded-xl border bg-white p-4 transition ${
        selected
          ? 'border-violet-400 shadow-sm ring-2 ring-violet-100'
          : card.reviewStatus === 'pending'
            ? 'border-amber-300 bg-amber-50/20 hover:shadow-md'
          : 'border-slate-200 hover:shadow-md'
      }`}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 pr-8">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(card.id)}
            className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
            aria-label={`选择第 ${index + 1} 张卡片`}
          />
          <span className="rounded-full bg-violet-600 px-2.5 py-1 text-xs font-bold text-white">
            {index + 1}
          </span>
        </label>
        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-800">
          {card.type || '未分类'}
        </span>
        {card.origin === 'ai' && (
          <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-800">
            AI 候选
          </span>
        )}
        {card.reviewStatus === 'pending' && (
          <button
            type="button"
            onClick={() => onApprove(card.id)}
            disabled={hasBlockingIssue}
            title={
              hasBlockingIssue
                ? '请先修正阻塞质量问题'
                : '批准这张 AI 候选卡'
            }
            className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {hasBlockingIssue ? '待审核 · 需先修正' : '待审核 · 点击批准'}
          </button>
        )}
        {typeof card.confidence === 'number' && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            可信度 {Math.round(card.confidence * 100)}%
          </span>
        )}
        {card.sourcePage && (
          <button
            type="button"
            onClick={() => onOpenSource?.(card.id)}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
            title="在 PDF 中定位原文"
          >
            <MapPin size={12} />
            PDF 第 {card.sourcePage} 页 · 定位
          </button>
        )}
      </div>

      {qualityIssues.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" aria-label="卡片质量问题">
          {qualityIssues.map((item) => (
            <span
              key={item.code}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                item.severity === 'blocking'
                  ? 'bg-red-50 text-red-700'
                  : 'bg-amber-50 text-amber-700'
              }`}
              title={item.message}
            >
              {item.severity === 'blocking' ? (
                <ShieldAlert size={13} />
              ) : (
                <AlertTriangle size={13} />
              )}
              {item.message}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onDelete(card.id)}
        className="absolute right-4 top-4 text-slate-400 transition hover:text-red-500 focus-visible:text-red-500"
        aria-label={`删除第 ${index + 1} 张卡片`}
        title="删除此卡片"
      >
        <Trash2 size={18} />
      </button>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-semibold text-slate-500">问题</span>
          <textarea
            value={card.question}
            onChange={(event) =>
              onUpdate(card.id, 'question', event.target.value)
            }
            className={`${fieldClass} min-h-20 resize-y`}
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-semibold text-slate-500">答案</span>
          <textarea
            value={card.answer}
            onChange={(event) =>
              onUpdate(card.id, 'answer', event.target.value)
            }
            className={`${fieldClass} min-h-20 resize-y`}
          />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-semibold text-slate-500">
            选项（每行一个）
          </span>
          <textarea
            value={card.options}
            onChange={(event) =>
              onUpdate(card.id, 'options', event.target.value)
            }
            className={`${fieldClass} min-h-20 resize-y`}
          />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-semibold text-slate-500">
            解析/来源说明
          </span>
          <textarea
            value={card.analysis}
            onChange={(event) =>
              onUpdate(card.id, 'analysis', event.target.value)
            }
            className={`${fieldClass} min-h-20 resize-y`}
          />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">考点</span>
          <input
            value={card.point}
            onChange={(event) =>
              onUpdate(card.id, 'point', event.target.value)
            }
            className={fieldClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">卡片类型</span>
          <input
            value={card.type}
            onChange={(event) =>
              onUpdate(card.id, 'type', event.target.value)
            }
            className={fieldClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">章节</span>
          <input
            value={card.chapter}
            onChange={(event) =>
              onUpdate(card.id, 'chapter', event.target.value)
            }
            className={fieldClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-500">
            标签（逗号分隔）
          </span>
          <input
            value={card.tags.join(', ')}
            onChange={(event) =>
              onUpdate(
                card.id,
                'tags',
                event.target.value
                  .split(/[,，]/)
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              )
            }
            className={fieldClass}
          />
        </label>
      </div>

      {card.sourceQuote && (
        <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">
            查看引用的原文依据
          </summary>
          <blockquote className="mt-2 whitespace-pre-line border-l-2 border-violet-300 pl-3 text-sm leading-relaxed text-slate-600">
            {card.sourceQuote}
          </blockquote>
        </details>
      )}
    </article>
  );
}
