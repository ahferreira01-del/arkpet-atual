import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AdvancedDataTable } from "@/components/ui/advanced-data-table";
import { useListAllInvoices, useVoidInvoice, useRefundInvoice } from "@/hooks/use-financial";
import { useToast } from "@/hooks/use-toast";
import { formatCentsToBRL } from "@/lib/money";
import { parseLocalDate } from "@/lib/date-utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function DefaultersTab({ crecheId }: { crecheId: number }) {
  const { data: invoicesData, isLoading } = useListAllInvoices(crecheId);
  const refundMutation = useRefundInvoice(crecheId);
  const voidMutation = useVoidInvoice(crecheId);
  const { toast } = useToast();

  const handleVoid = (id: number) => {
    if (!confirm("Tem certeza que deseja cancelar esta fatura?")) return;
    voidMutation.mutate(id, {
      onSuccess: () => toast({ title: "Sucesso", description: "Fatura cancelada com sucesso." }),
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const invoiceList = invoicesData?.data || (Array.isArray(invoicesData) ? invoicesData : []);
  const overdueInvoices = invoiceList.filter((inv: any) => {
    if (inv.status === 'overdue') return true;
    if (inv.status === 'pending' && inv.dueDate) {
      // Consider overdue if due date is before today
      return parseLocalDate(inv.dueDate).getTime() < new Date().setHours(0,0,0,0);
    }
    return false;
  });

  const columns = React.useMemo(() => [
    { accessorKey: "tutorName", header: "Tutor", cell: (info: any) => <span className="font-medium text-foreground">{info.getValue() || "Desconhecido"}</span> },
    { accessorKey: "dueDate", header: "Vencimento", cell: (info: any) => info.getValue() ? format(parseLocalDate(info.getValue()), "dd/MM/yyyy", { locale: ptBR }) : "—" },
    { accessorKey: "amount", header: "Valor", meta: { exportValue: (v: any) => formatCentsToBRL(Number(v)) }, cell: (info: any) => <span className="font-medium text-foreground">{formatCentsToBRL(info.getValue())}</span> },
    {
      id: "daysLate",
      header: "Dias Atraso",
      cell: ({ row }: any) => {
         const inv = row.original;
         const daysLate = inv.dueDate ? Math.floor((new Date().getTime() - parseLocalDate(inv.dueDate).getTime()) / (1000 * 3600 * 24)) : 0;
         return <span className="text-destructive font-bold">{daysLate} dias</span>;
      }
    },
    {
      id: "actions",
      header: () => <div className="text-right">Ações</div>,
      cell: ({ row }: any) => {
        const inv = row.original;
        const msg = encodeURIComponent(`Olá ${inv.tutorName || "Tutor"}, notamos que há uma fatura em aberto no valor de ${formatCentsToBRL(inv.amount)}. Poderia verificar?`);
        return (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" onClick={() => handleVoid(inv.id)} disabled={voidMutation.isPending}>
              Cancelar
            </Button>
            <Button size="sm" variant="outline" className="text-success border-success/30 hover:bg-success/10" onClick={() => window.open(`https://wa.me/?text=${msg}`, '_blank')}>
              Cobrar
            </Button>
          </div>
        );
      }
    }
  ], [voidMutation.isPending]);

  const totalDefaulters = overdueInvoices.reduce((sum: number, inv: any) => sum + Number(inv.amount || 0), 0);

  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando inadimplentes...</div>;

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-destructive/10 to-transparent border-destructive/20">
        <CardContent className="p-6">
          <h3 className="text-sm font-medium text-destructive mb-2">Total em Inadimplência</h3>
          <p className="text-3xl font-display font-bold text-foreground">
            {formatCentsToBRL(totalDefaulters)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-border flex justify-between items-center bg-muted/40">
            <h3 className="font-medium text-foreground">Faturas Inadimplentes</h3>
          </div>
          <div className="p-4">
             <AdvancedDataTable
               columns={columns}
               data={overdueInvoices}
               searchKey="tutorName"
               searchPlaceholder="Buscar tutor inadimplente..."
               fileName="Inadimplentes"
             />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
