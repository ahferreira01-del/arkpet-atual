import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useListAllInvoices, useApproveReceipt } from "@/hooks/use-financial";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCentsToBRL } from "@/lib/money";
import { buildMediaSrc, getMediaToken } from "@/features/feed/utils/media.utils";

export function ReceiptsTab({ crecheId }: { crecheId: number }) {
  const { data: invoicesData, isLoading } = useListAllInvoices(crecheId);
  const approveReceiptMutation = useApproveReceipt(crecheId);
  const { toast } = useToast();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleApproveReceipt = (id: number) => {
    approveReceiptMutation.mutate(id, {
      onSuccess: () => toast({ title: "Sucesso", description: "Comprovante aprovado e fatura liquidada." }),
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const pendingReceipts = invoicesData?.data?.filter((i: any) => i.status === 'awaiting_confirmation') || [];

  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando comprovantes...</div>;
  return (
    <>
    <Card>
      <CardContent className="p-6">
        <h3 className="font-medium text-foreground mb-6">Comprovantes Pendentes de Aprovação</h3>
        {/* ── MOBILE CARD VIEW ──────────────────────────────── */}
        <div className="md:hidden divide-y divide-border">
          {pendingReceipts.length > 0 ? (
            pendingReceipts.map((inv: any) => (
              <div key={inv.id} className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <p className="font-semibold text-foreground">{inv.tutorName || "Desconhecido"}</p>
                  <p className="font-bold text-foreground">{formatCentsToBRL(inv.amount)}</p>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Vencimento:</span>
                  <span className="text-foreground">{inv.dueDate ? format(new Date(inv.dueDate), "dd/MM/yyyy", { locale: ptBR }) : "—"}</span>
                </div>
                <div className="flex gap-2 pt-2 border-t border-border">
                  {inv.receiptPhotoPath && (
                    <Button variant="ghost" size="sm" onClick={() => {
                      setPreviewUrl(buildMediaSrc(inv.receiptPhotoPath, getMediaToken()));
                    }} className="flex-1 text-info hover:text-info/80 hover:bg-info/10">
                      Ver Comprovante
                    </Button>
                  )}
                  <Button size="sm" onClick={() => handleApproveReceipt(inv.id)} disabled={approveReceiptMutation.isPending} className="flex-1 bg-success hover:bg-success/90 text-success-foreground">
                    Aprovar
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-muted-foreground">Nenhum comprovante pendente.</div>
          )}
        </div>

        {/* ── DESKTOP TABLE VIEW ────────────────────────────── */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground bg-muted/40 uppercase">
              <tr>
                <th className="px-6 py-4 font-medium">Tutor</th>
                <th className="px-6 py-4 font-medium">Vencimento</th>
                <th className="px-6 py-4 font-medium">Valor</th>
                <th className="px-6 py-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pendingReceipts.length > 0 ? (
                pendingReceipts.map((inv: any) => (
                  <tr key={inv.id} className="hover:bg-secondary/50 transition-colors">
                    <td className="px-6 py-4 font-medium text-foreground">{inv.tutorName || "Desconhecido"}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {inv.dueDate ? format(parseLocalDate(inv.dueDate), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                    </td>
                    <td className="px-6 py-4 text-foreground font-medium">{formatCentsToBRL(inv.amount)}</td>
                    <td className="px-6 py-4 text-right space-x-2">
                      {inv.receiptPhotoPath && (
                        <Button variant="ghost" size="sm" onClick={() => {
                          setPreviewUrl(buildMediaSrc(inv.receiptPhotoPath, getMediaToken()));
                        }} className="text-info hover:text-info/80 hover:bg-info/10">
                          Ver Comprovante
                        </Button>
                      )}
                      <Button size="sm" onClick={() => handleApproveReceipt(inv.id)} disabled={approveReceiptMutation.isPending} className="bg-success hover:bg-success/90 text-success-foreground">
                        Aprovar
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                    Nenhum comprovante pendente.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>

    {previewUrl && (
      <Modal isOpen onClose={() => setPreviewUrl(null)} title="Comprovante de Pagamento">
        <div className="flex justify-center p-2">
          <img
            src={previewUrl}
            alt="Comprovante"
            className="max-w-full max-h-[75vh] rounded-lg object-contain"
          />
        </div>
      </Modal>
    )}
    </>
  );
}
