import { WifiOff, CheckCircle2, RefreshCw } from "lucide-react";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { Button } from "@/components/ui/button";

export function OfflineBanner() {
  const { isOnline, showRestoredNotice, checkConnection } = useNetworkStatus();

  if (isOnline && !showRestoredNotice) {
    return null;
  }

  if (showRestoredNotice) {
    return (
      <aside
        aria-live="polite"
        role="status"
        aria-label="Status da conexão"
        className="w-full bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-800 dark:text-emerald-300 px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium transition-all duration-300"
      >
        <CheckCircle2 className="h-4 w-4 text-emerald-800 dark:text-emerald-400 shrink-0" />
        <span>Conexão restabelecida. Dados sincronizados com o servidor.</span>
      </aside>
    );
  }

  return (
    <aside
      aria-live="assertive"
      role="alert"
      aria-label="Alerta de conexão"
      className="w-full bg-amber-500/15 border-b border-amber-500/30 text-amber-800 dark:text-amber-200 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm transition-all duration-300"
    >
      <div className="flex items-center gap-2">
        <WifiOff className="h-4 w-4 text-amber-800 dark:text-amber-400 shrink-0" />
        <span className="font-medium">
          Sem conexão com a internet. Operações que exigem servidor estão pausadas.
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => checkConnection()}
        className="h-7 text-xs border-amber-500/40 hover:bg-amber-500/20 text-amber-900 dark:text-amber-100 shrink-0"
      >
        <RefreshCw className="h-3 w-3 mr-1" />
        Tentar reconectar
      </Button>
    </aside>
  );
}
