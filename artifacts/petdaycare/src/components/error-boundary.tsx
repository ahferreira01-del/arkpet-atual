import React, { Component, type ReactNode, type ErrorInfo } from "react";
import { logError } from "@/lib/error-logger";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Optional custom fallback UI. Receives reset() callback. */
  fallback?: (reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * React Error Boundary — catches synchronous render/lifecycle errors in the
 * component tree, logs them via error-logger, and shows a recovery screen.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <YourApp />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
    this.reset = this.reset.bind(this);
  }

  static isChunkLoadError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return (
      msg.includes("dynamically imported module") ||
      msg.includes("Failed to fetch") ||
      msg.includes("Importing a module script failed") ||
      msg.includes("error loading dynamically imported module")
    );
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const message =
      error instanceof Error ? error.message : String(error);
    const stack =
      (error instanceof Error ? error.stack ?? "" : "") +
      "\n\nComponent Stack:\n" +
      info.componentStack;
    logError("boundary", message, stack);

    // Stale PWA chunk: new deploy changed the hash, service worker is serving
    // old HTML. Force a hard reload so the browser fetches fresh HTML + new
    // chunk set. Guard against infinite reload loops with sessionStorage.
    if (ErrorBoundary.isChunkLoadError(error)) {
      const key = "arkpet_chunk_reload";
      const attempts = parseInt(sessionStorage.getItem(key) ?? "0", 10);
      if (attempts < 3) {
        sessionStorage.setItem(key, String(attempts + 1));
        window.location.reload();
      }
    }
  }

  reset(): void {
    sessionStorage.removeItem("arkpet_chunk_reload");
    this.setState({ hasError: false, message: "" });
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback(this.reset);

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-6">
          <div className="flex justify-center">
            <div className="h-20 w-20 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="h-10 w-10 text-red-400" />
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-white">
              Algo deu errado
            </h1>
            <p className="text-sm text-muted-foreground">
              O ArkPet encontrou um erro inesperado. O problema foi registrado
              automaticamente.
            </p>
            {this.state.message && (
              <p className="text-xs text-red-400/80 bg-red-500/10 rounded-lg px-3 py-2 font-mono break-all">
                {this.state.message}
              </p>
            )}
          </div>

          <button
            onClick={this.reset}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </button>

          <p className="text-xs text-muted-foreground">
            Se o problema persistir, recarregue o app.
          </p>
        </div>
      </div>
    );
  }
}
