import {
  CheckCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { AiConnectionResult } from '../aiClient';
import type { AiSettings } from '../types';

interface ModelCenterModalProps {
  apiKey: string;
  connection: AiConnectionResult | null;
  isTesting: boolean;
  isBusy: boolean;
  onApiKeyChange: (value: string) => void;
  onClose: () => void;
  onClearCache: () => void;
  onSelectProvider: (provider: AiSettings['provider']) => void;
  onTest: () => void;
  onUpdate: <K extends keyof AiSettings>(
    key: K,
    value: AiSettings[K],
  ) => void;
  settings: AiSettings;
}

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-transparent focus:ring-2 focus:ring-violet-500';

export function ModelCenterModal({
  apiKey,
  connection,
  isTesting,
  isBusy,
  onApiKeyChange,
  onClose,
  onClearCache,
  onSelectProvider,
  onTest,
  onUpdate,
  settings,
}: ModelCenterModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    closeButtonRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-center-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/60 bg-slate-50 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-violet-700">
              <Settings2 size={18} />
              <h2 id="model-center-title" className="font-bold text-slate-950">
                模型中心
              </h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              技术配置集中保存在这里；API Key 仅停留在当前页面会话。
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭模型中心"
          >
            <X size={18} />
          </button>
        </header>

        <div className="overflow-y-auto p-4 sm:p-5">
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-800">
            <ShieldCheck className="mt-0.5 shrink-0" size={18} />
            <p className="leading-relaxed">
              生成结果仍会进入待审核队列。更换模型不会自动覆盖现有卡片。
            </p>
          </div>

          {connection && (
            <div className="mb-4 grid gap-2 rounded-xl border border-violet-100 bg-violet-50 p-3 text-xs text-violet-800 sm:grid-cols-3">
              <div>
                <span className="block text-violet-500">响应模型</span>
                <strong className="mt-1 block break-all">{connection.model}</strong>
              </div>
              <div>
                <span className="block text-violet-500">连接耗时</span>
                <strong className="mt-1 block">{connection.latencyMs} ms</strong>
              </div>
              <div>
                <span className="block text-violet-500">协议端点</span>
                <strong className="mt-1 block truncate" title={connection.endpoint}>
                  Chat Completions
                </strong>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              接口预设
              <select
                value={settings.provider}
                onChange={(event) =>
                  onSelectProvider(
                    event.target.value as AiSettings['provider'],
                  )
                }
                className={inputClass}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="ollama">本地 Ollama</option>
                <option value="custom">自定义 OpenAI-compatible</option>
              </select>
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-slate-600">
              模型名称
              <input
                value={settings.model}
                onChange={(event) => onUpdate('model', event.target.value)}
                placeholder="模型名称"
                className={inputClass}
              />
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-slate-600 sm:col-span-2">
              Base URL
              <input
                value={settings.baseUrl}
                onChange={(event) => onUpdate('baseUrl', event.target.value)}
                placeholder="https://api.example.com/v1"
                className={inputClass}
              />
            </label>
            <label className="space-y-1.5 text-xs font-semibold text-slate-600 sm:col-span-2">
              API Key（仅保存在当前页面会话）
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                placeholder={
                  settings.provider === 'ollama'
                    ? '本地接口通常可留空'
                    : 'sk-...'
                }
                className={inputClass}
              />
            </label>
          </div>

          <details className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-bold text-slate-700">
              高级调用设置
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-medium text-slate-500">
                每次分析长度
                <input
                  type="number"
                  min="1000"
                  max="30000"
                  value={settings.chunkSize}
                  onChange={(event) =>
                    onUpdate('chunkSize', event.target.value)
                  }
                  className={inputClass}
                />
              </label>
              <label className="space-y-1.5 text-xs font-medium text-slate-500">
                本次最多处理文本块
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={settings.maxChunks}
                  onChange={(event) =>
                    onUpdate('maxChunks', event.target.value)
                  }
                  className={inputClass}
                />
              </label>
              <label className="space-y-1.5 text-xs font-medium text-slate-500">
                每段最多生成卡片
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={settings.cardsPerChunk}
                  onChange={(event) =>
                    onUpdate('cardsPerChunk', event.target.value)
                  }
                  className={inputClass}
                />
              </label>
              <label className="space-y-1.5 text-xs font-medium text-slate-500">
                单次请求超时（秒）
                <input
                  type="number"
                  min="5"
                  max="120"
                  value={settings.requestTimeout}
                  onChange={(event) =>
                    onUpdate('requestTimeout', event.target.value)
                  }
                  className={inputClass}
                />
              </label>
              <label className="space-y-1.5 text-xs font-medium text-slate-500">
                临时故障重试次数
                <input
                  type="number"
                  min="0"
                  max="4"
                  value={settings.maxRetries}
                  onChange={(event) =>
                    onUpdate('maxRetries', event.target.value)
                  }
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 self-end rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={settings.jsonMode}
                  onChange={(event) =>
                    onUpdate('jsonMode', event.target.checked)
                  }
                />
                请求 JSON 模式
              </label>
              <label className="flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-medium text-slate-600 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={settings.useCache}
                  onChange={(event) =>
                    onUpdate('useCache', event.target.checked)
                  }
                  className="mt-0.5"
                />
                <span>
                  复用相同请求的本地结果
                  <span className="mt-0.5 block font-normal text-slate-400">
                    缓存键包含原文、模型、接口、提示词和生成参数，不包含 API Key。
                  </span>
                </span>
              </label>
            </div>
          </details>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-xs text-slate-500">
              <CheckCircle size={14} className="text-emerald-600" />
              当前模型：{settings.model || '尚未填写'}
            </span>
            <button
              type="button"
              onClick={onClearCache}
              disabled={isTesting || isBusy}
              className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-red-600 disabled:opacity-40"
            >
              <Trash2 size={13} /> 清空 AI 缓存
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onTest}
              disabled={isTesting || isBusy}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 sm:flex-none"
            >
              {isTesting ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <CheckCircle size={16} />
              )}
              {isTesting ? '测试中' : '测试连接'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 sm:flex-none"
            >
              完成配置
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
