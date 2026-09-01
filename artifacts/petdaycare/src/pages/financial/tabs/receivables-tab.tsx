import React, { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { type ColumnDef } from "@tanstack/react-table";
import { parseLocalDate } from "@/lib/date-utils";
import { formatCentsToBRL } from "@/lib/money";
import { useToast } from "@/hooks/use-toast";
import {
  useListAllInvoices,
  useRefundInvoice,
  useVoidInvoice,
  usePayManualInvoice,
  useApproveReceipt,
  useInvoiceItems,
  useRefundInvoiceItem,
} from "@/hooks/use-financial";
import { useFinancialContext } from "@/components/financial/financial-context";
import { buildMediaSrc, getMediaToken } from "@/features/feed/utils/media.utils";
import { parseStrictInteger } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { AdvancedDataTable } from "@/components/ui/advanced-data-table";
import { ThermalReceiptModal } from "@/components/modals/ThermalReceiptModal";
import {
  FileText,
  Receipt,
  CircleDollarSign,
  ArrowRight,
  PackageOpen,
  Printer,
  MoreHorizontal,
} from "lucide-react";

export type InvoiceStatus =
  | "pending"
  | "paid"
  | "overdue"
  | "voided"
  | "refunded"
  | "awaiting_confirmation";

export interface InvoiceRow {
  id: number;
  amount: number | string;
  status: InvoiceStatus | string;
  dueDate?: string | null;
  tutorId?: number | null;
  tutorName?: string | null;
  createdAt?: string | null;
  paymentMethod?: string | null;
  receiptPhotoPath?: string | null;
}

export interface InvoiceItem {
  id: number;
  description?: string | null;
  quantity?: number | null;
  amount: number | string;
  itemDate?: string | null;
  itemType?: string | null;
  petId?: number | null;
  petName?: string | null;
}

export interface InvoicesEnvelope {
  data?: InvoiceRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

function getErrorMessage(err: unknown, fallback = "Erro na operação."): string {
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return fallback;
}

function InvoiceERPView({ crecheId, invoiceId, open, onClose, invoiceStatus = "pending", issueDate = new Date().toISOString(), tutorName = "Tutor" }: { crecheId: number, invoiceId: number | null, open: boolean, onClose: () => void, invoiceStatus?: string, issueDate?: string, tutorName?: string }) {
  const { data: items, isLoading } = useInvoiceItems(crecheId, invoiceId || undefined);
  const refundItemMutation = useRefundInvoiceItem(crecheId);

  if (!open || !invoiceId) return null;

  const invoiceItems = items as InvoiceItem[] | undefined;
  const total = invoiceItems?.reduce((sum: number, item: InvoiceItem) => sum + (Number(item.amount) * (item.quantity || 1)), 0) || 0;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'pending': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'overdue': return 'bg-red-100 text-red-800 border-red-200';
      case 'voided': return 'bg-slate-100 text-slate-800 border-slate-200';
      case 'refunded': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'Paga';
      case 'pending': return 'Pendente';
      case 'overdue': return 'Atrasada';
      case 'voided': return 'Cancelada';
      case 'refunded': return 'Estornada';
      default: return status;
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`Fatura #${invoiceId} - Visão Executiva`} className="max-w-4xl">
      <div className="space-y-6 text-foreground">

        {/* Executive Header */}
        <div className="flex flex-col gap-3 p-5 bg-card rounded-2xl border shadow-sm">
          <div className="flex justify-between items-center border-b border-border/50 pb-2">
            <span className="text-sm text-muted-foreground font-medium">Tutor / Cliente</span>
            <span className="text-sm font-semibold truncate text-foreground">{tutorName}</span>
          </div>
          <div className="flex justify-between items-center border-b border-border/50 pb-2">
            <span className="text-sm text-muted-foreground font-medium">Data de Emissão</span>
            <span className="text-sm font-semibold text-foreground">{new Date(issueDate).toLocaleDateString('pt-BR')}</span>
          </div>
          <div className="flex justify-between items-center border-b border-border/50 pb-2">
            <span className="text-sm text-muted-foreground font-medium">Status da Fatura</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getStatusColor(invoiceStatus)}`}>
              {getStatusLabel(invoiceStatus)}
            </span>
          </div>
          <div className="flex justify-between items-center pt-1">
            <span className="text-sm text-muted-foreground font-medium">Valor Total</span>
            <span className="text-lg font-bold text-emerald-500">{formatCentsToBRL(total)}</span>
          </div>
        </div>

        {/* Timeline */}
        <div className="p-4 bg-card rounded-lg border shadow-sm overflow-hidden">
          <h4 className="text-sm font-bold text-card-foreground mb-4">Linha do Tempo</h4>
          <div className="flex sm:items-center sm:justify-between relative flex-col sm:flex-row gap-6 sm:gap-0">
            <div className="hidden sm:block absolute top-1/2 left-0 w-full h-0.5 bg-muted -z-10 -translate-y-1/2"></div>
            <div className="sm:hidden absolute top-0 left-[15px] w-0.5 h-full bg-muted -z-10"></div>

            <div className="flex sm:flex-col items-center sm:justify-center gap-3 sm:gap-0">
              <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center border-4 border-card shadow-sm z-10 shrink-0">
                <FileText className="w-4 h-4" />
              </div>
              <p className="text-xs font-medium sm:mt-2 text-card-foreground">Criada</p>
            </div>

            <div className="flex sm:flex-col items-center sm:justify-center gap-3 sm:gap-0">
              <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center border-4 border-card shadow-sm z-10 shrink-0">
                <Receipt className="w-4 h-4" />
              </div>
              <p className="text-xs font-medium sm:mt-2 text-card-foreground">Enviada</p>
            </div>

            <div className="flex sm:flex-col items-center sm:justify-center gap-3 sm:gap-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-4 border-card shadow-sm z-10 shrink-0 ${invoiceStatus === 'paid' ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                <CircleDollarSign className="w-4 h-4" />
              </div>
              <p className={`text-xs font-medium sm:mt-2 ${invoiceStatus === 'paid' ? 'text-card-foreground' : 'text-muted-foreground'}`}>Paga</p>
            </div>

            <div className="flex sm:flex-col items-center sm:justify-center gap-3 sm:gap-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-4 border-card shadow-sm z-10 shrink-0 ${invoiceStatus === 'refunded' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                <ArrowRight className="w-4 h-4" />
              </div>
              <p className={`text-xs font-medium sm:mt-2 ${invoiceStatus === 'refunded' ? 'text-card-foreground' : 'text-muted-foreground'}`}>Estornada</p>
            </div>
          </div>
        </div>

        {/* Items Details */}
        <div className="p-4 bg-card rounded-lg border shadow-sm">
           <h4 className="text-sm font-bold text-card-foreground mb-4">Itens da Fatura</h4>
          {isLoading ? (
            <div className="text-center p-8 text-muted-foreground">Carregando itens...</div>
          ) : (invoiceItems && invoiceItems.length > 0) ? (
            <div className="divide-y divide-slate-100">
              {invoiceItems.map((item: InvoiceItem) => {
                const unitPrice = Number(item.amount);
                const qty = item.quantity || 1;
                const lineTotal = unitPrice * qty;
                const formattedDate = item.itemDate ? new Date(item.itemDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '';
                return (
                  <div key={item.id} className="py-3 flex justify-between items-center gap-3 group">
                    <div className="flex items-center min-w-0 flex-1">
                      <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center mr-3 shrink-0">
                        <PackageOpen className="w-5 h-5 text-slate-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 break-words">
                          {item.description}
                          {item.petName && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 shrink-0">{item.petName}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center flex-wrap gap-x-2 mt-1">
                          {formattedDate && <span>{formattedDate} &bull;</span>}
                          <span>{qty} unidade(s) x {formatCentsToBRL(unitPrice)}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm font-bold text-foreground">
                      <span className="text-right">{formatCentsToBRL(lineTotal)}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const refundQtyStr = prompt(`Quantos itens deseja estornar? (Máximo: ${qty})`, "1");
                          if (!refundQtyStr) return;
                          const refundQty = parseStrictInteger(refundQtyStr, { min: 1, max: qty });
                          if (refundQty === null) {
                            alert("Quantidade inválida.");
                            return;
                          }
                          refundItemMutation.mutate({ invoiceId: invoiceId!, invoiceItemId: item.id, quantity: refundQty }, {
                            onSuccess: () => alert("Estorno/Devolução realizado com sucesso."),
                            onError: (err: unknown) => alert(`Erro ao estornar: ${getErrorMessage(err, "Tente novamente.")}`),
                          });
                        }}
                        className="h-8 px-3 text-xs border-destructive text-destructive hover:bg-destructive hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                        disabled={refundItemMutation.isPending || invoiceStatus !== 'paid'}
                      >
                        Estornar
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center p-8 text-slate-400">Nenhum item encontrado.</div>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">Fechar Painel</Button>
        </div>
      </div>
    </Modal>
  );
}

export function ReceivablesTab({ crecheId }: { crecheId: number }) {
  const { data: invoicesData, isLoading } = useListAllInvoices(crecheId);
  const refundMutation = useRefundInvoice(crecheId);
  const voidMutation = useVoidInvoice(crecheId);
  const payManualMutation = usePayManualInvoice(crecheId);
  const approveReceiptMutation = useApproveReceipt(crecheId);
  const { toast } = useToast();

  const [payModal, setPayModal] = useState<{ open: boolean; invoiceId: number | null }>({ open: false, invoiceId: null });
  const [receiptModalId, setReceiptModalId] = useState<number | null>(null);
  const [detailsModal, setDetailsModal] = useState<{open: boolean, invoiceId: number | null}>({ open: false, invoiceId: null });
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("pix");

  // Filters
  const [tutorFilter, setTutorFilter] = useState("");
  const { startDate: startDateFilter, endDate: endDateFilter } = useFinancialContext();

  // tutor dropdown removed in favor of AdvancedDataTable global search

  const handleRefund = (id: number) => {
    if (!confirm("Tem certeza que deseja estornar esta fatura?")) return;
    refundMutation.mutate(id, {
      onSuccess: () => toast({ title: "Sucesso", description: "Fatura estornada com sucesso." }),
      onError: (err: unknown) => toast({ title: "Erro", description: getErrorMessage(err, "Erro ao estornar fatura."), variant: "destructive" })
    });
  };

  const handleVoid = (id: number) => {
    if (!confirm("Tem certeza que deseja cancelar esta fatura?")) return;
    voidMutation.mutate(id, {
      onSuccess: () => toast({ title: "Sucesso", description: "Fatura cancelada com sucesso." }),
      onError: (err: unknown) => toast({ title: "Erro", description: getErrorMessage(err, "Erro ao cancelar fatura."), variant: "destructive" })
    });
  };

  const handlePayManual = () => {
    if (!payModal.invoiceId) return;
    payManualMutation.mutate({ invoiceId: payModal.invoiceId, paymentMethod }, {
      onSuccess: () => {
        toast({ title: "Sucesso", description: "Baixa manual realizada com sucesso.", variant: "default" });
        setPayModal({ open: false, invoiceId: null });
      },
      onError: (err: unknown) => toast({ title: "Erro", description: getErrorMessage(err, "Erro ao realizar baixa manual."), variant: "destructive" })
    });
  };

  const handleApproveReceipt = (id: number) => {
    if (!confirm("Confirmar o recebimento via comprovante Pix?")) return;
    approveReceiptMutation.mutate(id, {
      onSuccess: () => toast({ title: "Sucesso", description: "Comprovante aprovado com sucesso.", variant: "default" }),
      onError: (err: unknown) => toast({ title: "Erro", description: getErrorMessage(err, "Erro ao aprovar comprovante."), variant: "destructive" })
    });
  };

  // Opens receipt synchronously so browsers don't block the popup.
  // buildMediaSrc appends ?mt= so the storage endpoint accepts the request
  // without an Authorization header (which <a>/<window.open> cannot send).
  const handleViewReceipt = (receiptPhotoPath?: string | null) => {
    if (!receiptPhotoPath) return;
    setPreviewUrl(buildMediaSrc(receiptPhotoPath, getMediaToken()));
  };

  const invoicePayload = invoicesData as InvoicesEnvelope | InvoiceRow[] | undefined;
  const invoiceList: InvoiceRow[] = Array.isArray(invoicePayload) ? invoicePayload : invoicePayload?.data ?? [];

  const columns = React.useMemo<ColumnDef<InvoiceRow, unknown>[]>(() => [
    { accessorKey: "tutorName", header: "Tutor", cell: (info) => info.row.original.tutorName || "Desconhecido" },
    { accessorKey: "createdAt", header: "Emissão", cell: (info) => {
      const createdAt = info.row.original.createdAt;
      return createdAt ? format(new Date(createdAt), "dd/MM/yyyy", { locale: ptBR }) : "—";
    } },
    { accessorKey: "dueDate", header: "Vencimento", cell: (info) => {
        const inv = info.row.original;
        const val = inv.dueDate;
        const isOverdue = val && ['pending', 'overdue'].includes(inv.status) && parseLocalDate(val).getTime() < new Date().setHours(0,0,0,0);
        return <span className={isOverdue ? "text-red-400 font-medium" : ""}>{val ? format(parseLocalDate(val), "dd/MM/yyyy", { locale: ptBR }) : "—"}</span>;
    } },
    { accessorKey: "amount", header: "Valor", meta: { exportValue: (v: unknown) => formatCentsToBRL(Number(v)) }, cell: (info) => formatCentsToBRL(Number(info.row.original.amount)) },
    { accessorKey: "status", header: "Status", cell: (info) => {
        const status = info.row.original.status;
        return (
          <Badge variant={status === "paid" ? "success" : status === "awaiting_confirmation" ? "default" : status === "refunded" ? "outline" : status === "voided" ? "secondary" : status === "overdue" ? "destructive" : "secondary"}>
            {status === "paid" ? "Pago" : status === "awaiting_confirmation" ? "Em Análise" : status === "refunded" ? "Estornado" : status === "voided" ? "Cancelado" : status === "overdue" ? "Atrasado" : "Pendente"}
          </Badge>
        );
    } },
    {
      id: "actions",
      header: () => <div className="text-right">Ações</div>,
      cell: ({ row }) => {
        const inv = row.original;
        return (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setDetailsModal({ open: true, invoiceId: inv.id })} className="text-muted-foreground hover:text-white hover:bg-white/10">
              Detalhes
            </Button>
            {inv.receiptPhotoPath && (
              <Button variant="ghost" size="sm" onClick={() => handleViewReceipt(inv.receiptPhotoPath)} className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10">
                Ver Comprovante
              </Button>
            )}
            {inv.status === "awaiting_confirmation" && (
              <Button variant="ghost" size="sm" onClick={() => handleApproveReceipt(inv.id)} disabled={approveReceiptMutation.isPending} className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10">
                Aprovar
              </Button>
            )}
            {inv.status === "paid" && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setReceiptModalId(inv.id)} className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10">
                  <Printer className="mr-1.5 h-3.5 w-3.5" /> Recibo NFC-e
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleRefund(inv.id)} disabled={refundMutation.isPending} className="text-red-400 hover:text-red-300 hover:bg-red-400/10">
                  Estornar
                </Button>
              </>
            )}
            {(inv.status === "pending" || inv.status === "overdue") && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setPayModal({ open: true, invoiceId: inv.id })} className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10">
                  Receber
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleVoid(inv.id)} disabled={voidMutation.isPending} className="text-muted-foreground hover:text-white hover:bg-white/10">
                  Cancelar
                </Button>
              </>
            )}
          </div>
        );
      }
    }
  ], [approveReceiptMutation.isPending, refundMutation.isPending, voidMutation.isPending]);

  const renderMobileCard = React.useCallback((row: { original: InvoiceRow }) => {
    const inv = row.original;
    const isOverdue = inv.dueDate && ['pending', 'overdue'].includes(inv.status) && parseLocalDate(inv.dueDate).getTime() < new Date().setHours(0,0,0,0);
    const dueDateStr = inv.dueDate ? format(parseLocalDate(inv.dueDate), "dd/MM/yyyy", { locale: ptBR }) : "—";

    return (
      <div className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-4 shadow-sm relative overflow-hidden">
        {/* Top: Tutor + Status */}
        <div className="flex justify-between items-start gap-2">
          <div className="flex flex-col">
            <span className="font-semibold text-foreground leading-tight truncate max-w-[200px]">{inv.tutorName || "Desconhecido"}</span>
            <span className="text-xs text-muted-foreground mt-0.5">#{inv.id}</span>
          </div>
          <Badge variant={inv.status === "paid" ? "success" : inv.status === "awaiting_confirmation" ? "default" : inv.status === "refunded" ? "outline" : inv.status === "voided" ? "secondary" : inv.status === "overdue" ? "destructive" : "secondary"}>
            {inv.status === "paid" ? "Pago" : inv.status === "awaiting_confirmation" ? "Em Análise" : inv.status === "refunded" ? "Estornado" : inv.status === "voided" ? "Cancelado" : inv.status === "overdue" ? "Atrasado" : "Pendente"}
          </Badge>
        </div>

        {/* Middle: Value + Dates */}
        <div className="grid grid-cols-2 gap-2 bg-muted/30 p-3 rounded-xl border border-border">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Valor</span>
            <span className="text-sm font-bold text-foreground">{formatCentsToBRL(Number(inv.amount))}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Vencimento</span>
            <span className={`text-sm font-semibold ${isOverdue ? "text-destructive" : "text-foreground"}`}>{dueDateStr}</span>
          </div>
        </div>

        {/* Footer: Actions */}
        <div className="flex justify-end items-center gap-2 pt-1">
          {(inv.status === "pending" || inv.status === "overdue") && (
            <Button size="sm" onClick={() => setPayModal({ open: true, invoiceId: inv.id })} className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[100px] h-9">
              Receber
            </Button>
          )}
          {inv.status === "awaiting_confirmation" && (
            <Button size="sm" onClick={() => handleApproveReceipt(inv.id)} disabled={approveReceiptMutation.isPending} className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[100px] h-9">
              Aprovar
            </Button>
          )}

          {inv.status !== "pending" && inv.status !== "overdue" && inv.status !== "awaiting_confirmation" && (
             <Button variant="outline" size="sm" onClick={() => setDetailsModal({ open: true, invoiceId: inv.id })} className="h-9 border-border">
              Detalhes
             </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Mais opções da fatura" className="h-9 w-9">
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {(inv.status === "pending" || inv.status === "overdue" || inv.status === "awaiting_confirmation") && (
                 <DropdownMenuItem onClick={() => setDetailsModal({ open: true, invoiceId: inv.id })}>
                   Detalhes
                 </DropdownMenuItem>
              )}
              {inv.receiptPhotoPath && (
                <DropdownMenuItem onClick={() => handleViewReceipt(inv.receiptPhotoPath)}>
                  Ver Comprovante
                </DropdownMenuItem>
              )}
              {inv.status === "paid" && (
                <>
                  <DropdownMenuItem onClick={() => setReceiptModalId(inv.id)}>
                    <Printer className="mr-2 h-4 w-4" /> Recibo NFC-e
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleRefund(inv.id)} disabled={refundMutation.isPending} className="text-destructive focus:text-destructive">
                    Estornar
                  </DropdownMenuItem>
                </>
              )}
              {(inv.status === "pending" || inv.status === "overdue") && (
                <DropdownMenuItem onClick={() => handleVoid(inv.id)} disabled={voidMutation.isPending} className="text-destructive focus:text-destructive">
                  Cancelar Fatura
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  }, [approveReceiptMutation.isPending, refundMutation.isPending, voidMutation.isPending]);

  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando contas a receber...</div>;
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <div className="p-4">
            <AdvancedDataTable
              columns={columns}
              data={invoiceList}
              searchKey="tutorName"
              searchPlaceholder="Buscar por tutor..."
              fileName="A_Receber"
              renderMobileCard={renderMobileCard}
            />
          </div>
        </CardContent>
      </Card>

      {payModal.open && (
        <Modal isOpen={true} onClose={() => setPayModal({ open: false, invoiceId: null })} title="Dar Baixa Manual">
          <div className="space-y-6 pt-2">
            {invoiceList.find((i: InvoiceRow) => i.id === payModal.invoiceId) && (
              <div className="bg-muted/30 p-4 rounded-xl flex flex-col gap-1 border border-border shadow-sm">
                <div className="flex justify-between items-start">
                  <span className="font-semibold text-foreground truncate mr-2">{invoiceList.find((i: InvoiceRow) => i.id === payModal.invoiceId)?.tutorName || "Desconhecido"}</span>
                  <span className="text-xs text-muted-foreground shrink-0 mt-0.5">#{payModal.invoiceId}</span>
                </div>
                <div className="text-2xl font-bold text-foreground mt-1 tracking-tight">
                  {formatCentsToBRL(Number(invoiceList.find((i: InvoiceRow) => i.id === payModal.invoiceId)?.amount || 0))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Método de Pagamento</label>
              <select
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
              >
                <option value="pix" className="bg-background text-foreground">Pix</option>
                <option value="cash" className="bg-background text-foreground">Dinheiro</option>
                <option value="credit_card" className="bg-background text-foreground">Cartão de Crédito/Débito (Maquininha)</option>
                <option value="bank_slip" className="bg-background text-foreground">Boleto (Externo)</option>
              </select>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setPayModal({ open: false, invoiceId: null })} className="h-11 sm:h-10 min-w-[120px] rounded-full">
                Cancelar
              </Button>
              <Button onClick={handlePayManual} isLoading={payManualMutation.isPending} className="h-11 sm:h-10 min-w-[150px] rounded-full bg-primary text-primary-foreground hover:bg-primary/90">
                Confirmar Recebimento
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <InvoiceERPView
        crecheId={crecheId}
        invoiceId={detailsModal.invoiceId}
        open={detailsModal.open}
        onClose={() => setDetailsModal({ open: false, invoiceId: null })}
        invoiceStatus={invoiceList.find((i: InvoiceRow) => i.id === detailsModal.invoiceId)?.status}
        issueDate={invoiceList.find((i: InvoiceRow) => i.id === detailsModal.invoiceId)?.createdAt ?? undefined}
        tutorName={invoiceList.find((i: InvoiceRow) => i.id === detailsModal.invoiceId)?.tutorName ?? undefined}
      />
      {previewUrl && (
        <Modal isOpen onClose={() => setPreviewUrl(null)} title="Comprovante de Pagamento">
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex justify-center bg-muted/30 rounded-xl border border-border p-2 sm:p-4 overflow-hidden">
              <img
                src={previewUrl}
                alt="Comprovante"
                className="max-w-full max-h-[70vh] rounded-lg object-contain shadow-sm"
              />
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setPreviewUrl(null)} className="h-11 sm:h-10 min-w-[120px] rounded-full">
                Fechar
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {receiptModalId && (
        <ThermalReceiptModal invoiceId={receiptModalId} onClose={() => setReceiptModalId(null)} />
      )}
    </div>
  );
}
