import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Render-prop fallback. Default is a centered error card with reload. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
  /** Reset boundary state when this key changes (e.g. route change). */
  resetKey?: unknown;
};

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
    return <DefaultFallback error={this.state.error} onReset={this.reset} />;
  }
}

function DefaultFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div
        role="alert"
        className="max-w-md rounded-lg border border-red-500/30 bg-slate-900 p-6 shadow-lg"
      >
        <h1 className="text-lg font-semibold text-red-300">Something went wrong</h1>
        <p className="mt-2 break-words font-mono text-xs text-slate-400">{error.message}</p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 hover:border-slate-600 hover:bg-slate-700"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 hover:border-slate-600 hover:bg-slate-700"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
