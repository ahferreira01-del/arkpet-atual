import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useListAuditLogs, useCreche, useUpdateCrecheSettings } from "@/hooks/use-financial";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function AuditTab({ crecheId }: { crecheId: number }) {
  const { data: logs, isLoading: isLogsLoading } = useListAuditLogs(crecheId);
  const { data: creche, isLoading: isCrecheLoading } = useCreche(crecheId);
  const updateSettingsMutation = useUpdateCrecheSettings(crecheId);
  const { toast } = useToast();

  const handleToggleAudit = () => {
    if (!creche) return;
    const newValue = !creche.auditEnabled;
    updateSettingsMutation.mutate({ auditEnabled: newValue }, {
      onSuccess: () => {
        toast({ title: "Sucesso", description: `Auditoria ${newValue ? 'ativada' : 'desativada'}.` });
      },
      onError: (err: any) => {
        toast({ title: "Erro", description: err.message, variant: "destructive" });
      }
    });
  };

  if (isLogsLoading || isCrecheLoading) return <div className="text-center p-8 text-muted-foreground">Carregando trilha de auditoria...</div>;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-medium text-white">Trilha de Auditoria Financeira</h3>
          <Button
            variant={creche?.auditEnabled ? "destructive" : "default"}
            size="sm"
            onClick={handleToggleAudit}
            disabled={updateSettingsMutation.isPending}
            className={!creche?.auditEnabled ? "bg-emerald-500 hover:bg-emerald-600" : ""}
          >
            {creche?.auditEnabled ? "Desativar Auditoria" : "Ativar Auditoria"}
          </Button>
        </div>
        {/* ── MOBILE CARD VIEW ──────────────────────────────── */}
        <div className="md:hidden divide-y divide-white/5 mt-4 border-t border-white/5">
          {logs?.length > 0 ? (
            logs.map((log: any) => (
              <div key={log.id} className="p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <p className="font-semibold text-white">{log.userName || "Desconhecido"}</p>
                  <Badge variant="outline" className="text-[10px] font-mono">{log.action}</Badge>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Data/Hora:</span>
                  <span className="text-white">{format(new Date(log.createdAt), "dd/MM/yy HH:mm", { locale: ptBR })}</span>
                </div>
                <div className="pt-2">
                  <p className="text-sm text-muted-foreground">{log.details || "—"}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-muted-foreground">Nenhum registro de auditoria.</div>
          )}
        </div>

        {/* ── DESKTOP TABLE VIEW ────────────────────────────── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground bg-black/20 uppercase">
              <tr>
                <th className="px-6 py-4 font-medium">Data/Hora</th>
                <th className="px-6 py-4 font-medium">Usuário</th>
                <th className="px-6 py-4 font-medium">Ação</th>
                <th className="px-6 py-4 font-medium">Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs?.length > 0 ? (
                logs.map((log: any) => (
                  <tr key={log.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 text-muted-foreground">
                      {format(new Date(log.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </td>
                    <td className="px-6 py-4 text-white">{log.userName || "Desconhecido"}</td>
                    <td className="px-6 py-4">
                      <Badge variant="outline" className="text-xs font-mono">{log.action}</Badge>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground max-w-md truncate" title={log.details || ""}>
                      {log.details || "—"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                    Nenhum registro de auditoria encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
