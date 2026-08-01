import {
  Check,
  FileArchive,
  Layers3,
  ScanText,
  Sparkles,
} from 'lucide-react';

export type WorkflowStep = 'import' | 'generate' | 'review' | 'export';

interface WorkflowStepperProps {
  currentStep: WorkflowStep;
  onChange: (step: WorkflowStep) => void;
  sourceReady: boolean;
  cardCount: number;
  exportableCount: number;
}

const steps = [
  {
    id: 'import' as const,
    label: '导入资料',
    shortLabel: '导入',
    description: '多格式文件或文本',
    icon: ScanText,
  },
  {
    id: 'generate' as const,
    label: '生成卡片',
    shortLabel: '生成',
    description: '本地规则或 AI',
    icon: Sparkles,
  },
  {
    id: 'review' as const,
    label: '审核精修',
    shortLabel: '审核',
    description: '校订与原文对照',
    icon: Layers3,
  },
  {
    id: 'export' as const,
    label: '导出牌组',
    shortLabel: '导出',
    description: 'APKG、TXT、JSON',
    icon: FileArchive,
  },
];

export function WorkflowStepper({
  currentStep,
  onChange,
  sourceReady,
  cardCount,
  exportableCount,
}: WorkflowStepperProps) {
  const canOpen = (step: WorkflowStep): boolean => {
    if (step === 'import') return true;
    if (step === 'generate') return sourceReady;
    if (step === 'review') return cardCount > 0;
    return exportableCount > 0;
  };
  const currentIndex = steps.findIndex((step) => step.id === currentStep);

  return (
    <nav
      aria-label="制卡流程"
      className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm sm:p-2"
    >
      <ol className="grid grid-cols-4 gap-1 sm:gap-2">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const active = step.id === currentStep;
          const completed = index < currentIndex && canOpen(step.id);
          const enabled = canOpen(step.id);
          return (
            <li key={step.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onChange(step.id)}
                disabled={!enabled}
                aria-current={active ? 'step' : undefined}
                className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-2 py-2 text-left transition sm:justify-start sm:px-3 ${
                  active
                    ? 'bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200'
                    : enabled
                      ? 'text-slate-600 hover:bg-slate-100'
                      : 'cursor-not-allowed text-slate-300'
                }`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                    active
                      ? 'bg-violet-100 text-violet-700'
                      : completed
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-slate-100'
                  }`}
                >
                  {completed ? <Check size={16} /> : <Icon size={16} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold sm:hidden">
                    {step.shortLabel}
                  </span>
                  <span className="hidden truncate text-sm font-bold sm:block">
                    {index + 1}. {step.label}
                  </span>
                  <span
                    className={`mt-0.5 hidden truncate text-[11px] lg:block ${
                      active ? 'text-violet-400' : 'text-slate-400'
                    }`}
                  >
                    {step.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
