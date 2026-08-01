import { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(): void {
    // Deliberately avoid logging workspace content or model configuration.
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-5 text-slate-800">
        <section className="w-full max-w-lg rounded-3xl border border-red-100 bg-white p-7 text-center shadow-xl">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-red-600">
            <AlertTriangle size={26} />
          </div>
          <h1 className="mt-5 text-xl font-bold text-slate-950">
            工作台遇到异常
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            当前草稿仍保存在浏览器中。重新加载通常可以恢复；此页面不会上传错误详情或工作区内容。
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700"
          >
            <RefreshCw size={16} /> 重新加载并恢复草稿
          </button>
        </section>
      </main>
    );
  }
}
