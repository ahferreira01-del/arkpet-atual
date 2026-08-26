import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs } from "@/components/ui/tabs";
import { Camera, ShieldAlert, BarChart3, Receipt, FileText, PackageOpen, ShoppingBag, Plus, MoreHorizontal, CircleDollarSign, ShoppingCart, Printer, Trash2, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdvancedDataTable } from "../../components/ui/advanced-data-table";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { useListAllInvoices, useListExpenses, useListCatalogue, useCreateExpense, usePayExpense, useRefundInvoice, useVoidInvoice, useCreateCatalogueItem, usePayManualInvoice, useApproveReceipt, useUpdateExpense, useDeleteExpense, useUpdateCatalogueItem, useDeleteCatalogueItem, useInvoiceItems, useListOrders, useUpdateOrderStatus, useRefundInvoiceItem, useStockTransactions, useStockAdjustment } from "@/hooks/use-financial";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { parseLocalDate } from "@/lib/date-utils";
import { useSearch, useLocation } from "wouter";
import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { POSSaleModal } from "@/components/financial/pos-sale-modal";
import { ExecutiveDashboardTab, SalesDashboardTab, ReportsCentralTab } from "./dashboards";
import { CashFlowTab } from "./tabs/cash-flow-tab";
import { AuditTab } from "./tabs/audit-tab";
import { LayoutDashboard, ArrowRight, ChevronDown, CheckCircle, Clock, Pencil } from "lucide-react";
import { CommandPalette } from "@/components/financial/command-palette";
import { CatalogueSmartIndicators } from "@/components/financial/smart-indicators";
import { FinancialProvider, useFinancialContext } from "@/components/financial/financial-context";
import { buildMediaSrc, getMediaToken } from "@/features/feed/utils/media.utils";
import { uploadFileDirect } from "@/lib/utils";


function InvoiceERPView({ crecheId, invoiceId, open, onClose, invoiceStatus = "pending", issueDate = new Date().toISOString(), tutorName = "Tutor" }: { crecheId: number, invoiceId: number | null, open: boolean, onClose: () => void, invoiceStatus?: string, issueDate?: string, tutorName?: string }) {
  const { data: items, isLoading } = useInvoiceItems(crecheId, invoiceId || undefined);
  const refundItemMutation = useRefundInvoiceItem(crecheId);

  if (!open || !invoiceId) return null;

  const total = items?.reduce((sum: number, item: any) => sum + (Number(item.amount) * (item.quantity || 1)), 0) || 0;

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
          ) : items?.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {items.map((item: any) => {
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
                          const refundQty = parseInt(refundQtyStr);
                          if (isNaN(refundQty) || refundQty < 1 || refundQty > qty) {
                            alert("Quantidade inválida.");
                            return;
                          }
                          refundItemMutation.mutate({ invoiceId: invoiceId!, invoiceItemId: item.id, quantity: refundQty }, {
                            onSuccess: () => alert("Estorno/Devolução realizado com sucesso."),
                            onError: (err: any) => alert(`Erro ao estornar: ${err?.message ?? "Tente novamente."}`),
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

function ReceivablesTab({ crecheId }: { crecheId: number }) {
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
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const handleVoid = (id: number) => {
    if (!confirm("Tem certeza que deseja cancelar esta fatura?")) return;
    voidMutation.mutate(id, {
      onSuccess: () => toast({ title: "Sucesso", description: "Fatura cancelada com sucesso." }),
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const handlePayManual = () => {
    if (!payModal.invoiceId) return;
    payManualMutation.mutate({ invoiceId: payModal.invoiceId, paymentMethod }, {
      onSuccess: () => {
        toast({ title: "Sucesso", description: "Baixa manual realizada com sucesso.", variant: "default" });
        setPayModal({ open: false, invoiceId: null });
      },
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const handleApproveReceipt = (id: number) => {
    if (!confirm("Confirmar o recebimento via comprovante Pix?")) return;
    approveReceiptMutation.mutate(id, {
      onSuccess: () => toast({ title: "Sucesso", description: "Comprovante aprovado com sucesso.", variant: "default" }),
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  // Opens receipt synchronously so browsers don't block the popup.
  // buildMediaSrc appends ?mt= so the storage endpoint accepts the request
  // without an Authorization header (which <a>/<window.open> cannot send).
  const handleViewReceipt = (receiptPhotoPath: string) => {
    setPreviewUrl(buildMediaSrc(receiptPhotoPath, getMediaToken()));
  };

  const invoiceList = invoicesData?.data || (Array.isArray(invoicesData) ? invoicesData : []);

  const columns = React.useMemo(() => [
    { accessorKey: "tutorName", header: "Tutor", cell: (info: any) => info.getValue() || "Desconhecido" },
    { accessorKey: "createdAt", header: "Emissão", cell: (info: any) => info.getValue() ? format(new Date(info.getValue()), "dd/MM/yyyy", { locale: ptBR }) : "—" },
    { accessorKey: "dueDate", header: "Vencimento", cell: (info: any) => {
        const val = info.getValue();
        const inv = info.row.original;
        const isOverdue = val && ['pending', 'overdue'].includes(inv.status) && parseLocalDate(val).getTime() < new Date().setHours(0,0,0,0);
        return <span className={isOverdue ? "text-red-400 font-medium" : ""}>{val ? format(parseLocalDate(val), "dd/MM/yyyy", { locale: ptBR }) : "—"}</span>;
    } },
    { accessorKey: "amount", header: "Valor", meta: { exportValue: (v: any) => formatCentsToBRL(Number(v)) }, cell: (info: any) => formatCentsToBRL(info.getValue()) },
    { accessorKey: "status", header: "Status", cell: (info: any) => {
        const status = info.getValue();
        return (
          <Badge variant={status === "paid" ? "success" : status === "awaiting_confirmation" ? "default" : status === "refunded" ? "outline" : status === "voided" ? "secondary" : status === "overdue" ? "destructive" : "secondary"}>
            {status === "paid" ? "Pago" : status === "awaiting_confirmation" ? "Em Análise" : status === "refunded" ? "Estornado" : status === "voided" ? "Cancelado" : status === "overdue" ? "Atrasado" : "Pendente"}
          </Badge>
        );
    } },
    {
      id: "actions",
      header: () => <div className="text-right">Ações</div>,
      cell: ({ row }: any) => {
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

  const renderMobileCard = React.useCallback((row: any) => {
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
            <span className="text-sm font-bold text-foreground">{formatCentsToBRL(inv.amount)}</span>
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
            {invoiceList.find((i:any) => i.id === payModal.invoiceId) && (
              <div className="bg-muted/30 p-4 rounded-xl flex flex-col gap-1 border border-border shadow-sm">
                <div className="flex justify-between items-start">
                  <span className="font-semibold text-foreground truncate mr-2">{invoiceList.find((i:any) => i.id === payModal.invoiceId)?.tutorName || "Desconhecido"}</span>
                  <span className="text-xs text-muted-foreground shrink-0 mt-0.5">#{payModal.invoiceId}</span>
                </div>
                <div className="text-2xl font-bold text-foreground mt-1 tracking-tight">
                  {formatCentsToBRL(invoiceList.find((i:any) => i.id === payModal.invoiceId)?.amount)}
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
        invoiceStatus={invoiceList.find((i:any) => i.id === detailsModal.invoiceId)?.status}
        issueDate={invoiceList.find((i:any) => i.id === detailsModal.invoiceId)?.createdAt}
        tutorName={invoiceList.find((i:any) => i.id === detailsModal.invoiceId)?.tutorName}
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

function PayablesTab({ crecheId }: { crecheId: number }) {
  const { data: expenses, isLoading } = useListExpenses(crecheId);
  const createMutation = useCreateExpense(crecheId);
  const updateMutation = useUpdateExpense(crecheId);
  const deleteMutation = useDeleteExpense(crecheId);
  const payMutation = usePayExpense(crecheId);
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ description: "", category: "operacional", amount: "", dueDate: "" });

  const openEditModal = (exp: any) => {
    setEditingId(exp.id);
    setForm({
      description: exp.description,
      category: exp.category,
      amount: (exp.amount / 100).toString(),
      dueDate: new Date(exp.dueDate || exp.date || new Date()).toISOString().split('T')[0]
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.description || !form.category || !form.amount || !form.dueDate) {
      toast({ title: "Erro", description: "Preencha todos os campos obrigatórios.", variant: "destructive" });
      return;
    }
    const rawAmount = form.amount.trim();
    if (rawAmount === "") {
      toast({ title: "Erro", description: "O valor é obrigatório.", variant: "destructive" });
      return;
    }
    const amountCents = parseReaisInputToCents(rawAmount);
    if (amountCents === null || amountCents < 0) {
      toast({ title: "Erro", description: "O valor deve ser um formato monetário válido e positivo.", variant: "destructive" });
      return;
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...form, amount: amountCents }, {
        onSuccess: () => {
          toast({ title: "Sucesso", description: "Despesa atualizada com sucesso." });
          setModalOpen(false);
          setEditingId(null);
          setForm({ description: "", category: "operacional", amount: "", dueDate: "" });
        },
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    } else {
      createMutation.mutate({ ...form, amount: amountCents }, {
        onSuccess: () => {
          toast({ title: "Sucesso", description: "Despesa registrada." });
          setModalOpen(false);
          setForm({ description: "", category: "operacional", amount: "", dueDate: "" });
        },
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Tem certeza que deseja excluir esta despesa?")) {
      deleteMutation.mutate(id, {
        onSuccess: () => toast({ title: "Sucesso", description: "Despesa excluída com sucesso." }),
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    }
  };

  const handlePay = (id: number) => {
    payMutation.mutate(id, {
      onSuccess: () => toast({ title: "Sucesso", description: "Despesa paga e baixada no fluxo de caixa." }),
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };


  
  const columns = React.useMemo(() => [
    { accessorKey: "description", header: "Descrição", cell: (info: any) => <span className="font-medium text-foreground">{info.getValue()}</span> },
    { accessorKey: "category", header: "Categoria", cell: (info: any) => <Badge variant="outline" className="capitalize font-normal text-muted-foreground">{info.getValue()}</Badge> },
    { accessorKey: "dueDate", header: "Vencimento", cell: (info: any) => {
        const d = info.getValue() || info.row.original.date || new Date();
        return <span className="text-muted-foreground">{format(new Date(d), "dd/MM/yyyy", { locale: ptBR })}</span>;
    } },
    { accessorKey: "amount", header: () => <div className="text-right">Valor</div>, meta: { exportValue: (v: any) => formatCentsToBRL(Number(v)) }, cell: (info: any) => <div className="text-right font-semibold text-destructive">-{formatCentsToBRL(info.getValue())}</div> },
    { accessorKey: "isPaid", header: "Status", cell: (info: any) => {
        return info.getValue() 
          ? <Badge variant="success">Pago</Badge> 
          : <Badge variant="secondary" className="text-muted-foreground">Pendente</Badge>;
    } },
    {
      id: "actions",
      header: () => <div className="text-right">Ações</div>,
      cell: ({ row }: any) => {
        const exp = row.original;
        return (
          <div className="flex justify-end gap-1">
            {!exp.isPaid && (
              <>
                <Button size="sm" onClick={() => handlePay(exp.id)} isLoading={payMutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground h-8">
                  Pagar
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Mais opções da despesa" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => openEditModal(exp)}>
                      <Pencil className="mr-2 h-4 w-4" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleDelete(exp.id)} disabled={deleteMutation.isPending} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        );
      }
    }
  ], [payMutation.isPending, deleteMutation.isPending]);

  const renderMobileCard = React.useCallback((row: any) => {
    const exp = row.original;
    const d = exp.dueDate || exp.date || new Date();
    const dueDateStr = format(new Date(d), "dd/MM/yyyy", { locale: ptBR });

    return (
      <div className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-4 shadow-sm relative overflow-hidden">
        <div className="flex justify-between items-start gap-2">
          <div className="flex flex-col">
            <span className="font-semibold text-foreground leading-tight">{exp.description}</span>
            <span className="text-xs text-muted-foreground mt-0.5 capitalize">{exp.category}</span>
          </div>
          {exp.isPaid 
            ? <Badge variant="success" className="shrink-0">Pago</Badge> 
            : <Badge variant="secondary" className="text-muted-foreground shrink-0">Pendente</Badge>
          }
        </div>

        <div className="grid grid-cols-2 gap-2 bg-muted/30 p-3 rounded-xl border border-border">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Valor</span>
            <span className="text-sm font-bold text-destructive">-{formatCentsToBRL(exp.amount)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Vencimento</span>
            <span className="text-sm font-semibold text-foreground">{dueDateStr}</span>
          </div>
        </div>

        <div className="flex justify-end items-center gap-2 pt-1">
          {!exp.isPaid && (
            <>
              <Button size="sm" onClick={() => handlePay(exp.id)} isLoading={payMutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[100px] h-9">
                Pagar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Mais opções da despesa" className="h-9 w-9">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => openEditModal(exp)}>
                    <Pencil className="mr-2 h-4 w-4" /> Editar Despesa
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleDelete(exp.id)} disabled={deleteMutation.isPending} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" /> Excluir Despesa
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>
    );
  }, [payMutation.isPending, deleteMutation.isPending]);

  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando despesas...</div>;

  return (
    <>
    <Card>
      <CardContent className="p-0">
        <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20">
          <h3 className="font-semibold text-foreground">Despesas Registradas</h3>
          <Button size="sm" onClick={() => {
            setEditingId(null);
            setForm({ description: "", category: "operacional", amount: "", dueDate: "" });
            setModalOpen(true);
          }} className="h-9">
            <Plus className="mr-2 h-4 w-4" /> Nova Despesa
          </Button>
        </div>
        <div className="p-4">
          <AdvancedDataTable 
            columns={columns} 
            data={expenses || []} 
            searchKey="description" 
            searchPlaceholder="Buscar despesa..." 
            fileName="Despesas" 
            renderMobileCard={renderMobileCard}
          />
        </div>
      </CardContent>
    </Card>

    {modalOpen && (
      <Modal isOpen={true} onClose={() => setModalOpen(false)} title={editingId ? "Editar Despesa" : "Nova Despesa"}>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Descrição <span className="text-destructive">*</span></label>
            <Input 
              value={form.description} 
              onChange={e => setForm({...form, description: e.target.value})} 
              placeholder="Ex: Conta de Luz" 
              className="h-11 sm:h-10 text-base sm:text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Categoria <span className="text-destructive">*</span></label>
            <Input 
              value={form.category} 
              onChange={e => setForm({...form, category: e.target.value})} 
              placeholder="Ex: operacional" 
              className="h-11 sm:h-10 text-base sm:text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Valor (R$) <span className="text-destructive">*</span></label>
              <Input 
                type="number" 
                min="0" 
                step="0.01" 
                value={form.amount} 
                onChange={e => setForm({...form, amount: e.target.value})} 
                placeholder="Ex: 150.00" 
                className="h-11 sm:h-10 text-base sm:text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Vencimento <span className="text-destructive">*</span></label>
              <Input 
                type="date" 
                value={form.dueDate} 
                onChange={e => setForm({...form, dueDate: e.target.value})} 
                className="h-11 sm:h-10 text-base sm:text-sm"
              />
            </div>
          </div>
          
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setModalOpen(false)} className="h-11 sm:h-10 min-w-[120px] rounded-full">
              Cancelar
            </Button>
            <Button onClick={handleSave} isLoading={createMutation.isPending || updateMutation.isPending} className="h-11 sm:h-10 min-w-[150px] rounded-full bg-primary text-primary-foreground hover:bg-primary/90">
              {editingId ? "Salvar Alterações" : "Salvar Despesa"}
            </Button>
          </div>
        </div>
      </Modal>
    )}
    </>
  );
}

function StockHistoryModal({ crecheId, itemId, itemName, onClose }: { crecheId: number; itemId: number; itemName: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useStockTransactions(crecheId, itemId, page, 20);
  const adjustMutation = useStockAdjustment(crecheId);
  const { toast } = useToast();

  const [adjDelta, setAdjDelta] = useState("");
  const [adjReason, setAdjReason] = useState("");

  const handleAdjust = () => {
    const delta = parseInt(adjDelta);
    if (!adjDelta || isNaN(delta) || delta === 0) {
      toast({ title: "Erro", description: "Informe um delta diferente de zero.", variant: "destructive" });
      return;
    }
    if (!adjReason.trim()) {
      toast({ title: "Erro", description: "Informe o motivo do ajuste.", variant: "destructive" });
      return;
    }
    adjustMutation.mutate({ itemId, delta, reason: adjReason.trim() }, {
      onSuccess: () => {
        toast({ title: "Sucesso", description: "Estoque ajustado com sucesso." });
        setAdjDelta("");
        setAdjReason("");
        setPage(1);
      },
      onError: (err: any) => {
        toast({ title: "Erro", description: err.message, variant: "destructive" });
      },
    });
  };

  const transactions = data?.data || [];
  const totalPages = data?.totalPages || 1;

  const typeLabel = (type: string) => {
    if (type === "in") return { label: "Entrada", color: "text-success bg-success/10" };
    if (type === "out") return { label: "Saída", color: "text-destructive bg-destructive/10" };
    return { label: "Ajuste", color: "text-warning bg-warning/10" };
  };

  const typeDelta = (type: string, qty: number) => {
    if (type === "in") return `+${qty}`;
    if (type === "out") return `-${qty}`;
    return `${qty}`;
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`Histórico de Estoque — ${itemName}`} className="max-w-2xl">
      <div className="space-y-6">
        
        {/* Inline adjustment form */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h4 className="text-sm font-semibold text-foreground mb-4">Ajustar Estoque</h4>
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-3 items-end">
            <div className="w-full sm:w-28">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Delta (+ / -)</label>
              <Input
                type="number"
                placeholder="ex: -3"
                value={adjDelta}
                onChange={e => setAdjDelta(e.target.value)}
                className="h-11 bg-background border-input text-foreground"
              />
            </div>
            <div className="w-full">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Motivo</label>
              <Input
                placeholder="ex: Quebra, recontagem..."
                value={adjReason}
                onChange={e => setAdjReason(e.target.value)}
                className="h-11 bg-background border-input text-foreground"
                onKeyDown={e => { if (e.key === "Enter") handleAdjust(); }}
              />
            </div>
            <Button
              onClick={handleAdjust}
              isLoading={adjustMutation.isPending}
              disabled={adjustMutation.isPending}
              className="h-11 w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Confirmar
            </Button>
          </div>
        </div>

        {/* Histórico */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-foreground">Movimentações</h4>
          
          {isLoading ? (
            <div className="text-center p-8 text-muted-foreground bg-muted/30 rounded-xl border border-border">Carregando histórico...</div>
          ) : transactions.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground bg-muted/30 rounded-xl border border-border">Nenhuma movimentação registrada.</div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
              <div className="hidden sm:grid grid-cols-5 gap-4 px-4 py-3 bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
                <span className="col-span-2">Data / Responsável</span>
                <span>Tipo</span>
                <span className="text-right">Delta</span>
                <span className="text-right">Motivo</span>
              </div>
              
              <div className="divide-y divide-border">
                {transactions.map((tx: any) => {
                  const { label, color } = typeLabel(tx.type);
                  return (
                    <div key={tx.id} className="flex flex-col sm:grid sm:grid-cols-5 gap-3 sm:gap-4 px-4 py-3.5 text-sm hover:bg-muted/30 transition-colors sm:items-center">
                      <div className="col-span-2 flex flex-col justify-center">
                        <p className="text-foreground font-medium">
                          {tx.createdAt ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(tx.createdAt)) : "—"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{tx.userName || "Sistema"}</p>
                      </div>
                      
                      <div className="flex justify-between sm:contents items-center mt-2 sm:mt-0">
                        <span className="sm:hidden text-xs text-muted-foreground font-medium">Tipo:</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold w-fit ${color}`}>{label}</span>
                      </div>
                      
                      <div className="flex justify-between sm:contents items-center mt-1 sm:mt-0">
                        <span className="sm:hidden text-xs text-muted-foreground font-medium">Delta:</span>
                        <span className={`sm:text-right font-bold text-base ${color.split(' ')[0]}`}>{typeDelta(tx.type, tx.quantity)}</span>
                      </div>
                      
                      {tx.reason && (
                        <div className="flex flex-col sm:block mt-1 sm:mt-0">
                          <span className="sm:hidden text-xs text-muted-foreground font-medium mb-0.5">Motivo:</span>
                          <span className="sm:text-right text-muted-foreground text-sm line-clamp-2 sm:line-clamp-1 break-words" title={tx.reason}>{tx.reason}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Pagination & Close */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-2">
          {totalPages > 1 ? (
            <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
              <Button className="h-11 px-4" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                Anterior
              </Button>
              <span className="text-sm font-medium text-muted-foreground">Página {page} de {totalPages}</span>
              <Button className="h-11 px-4" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                Próxima
              </Button>
            </div>
          ) : (
            <div className="hidden sm:block"></div>
          )}
          
          <Button className="h-11 w-full sm:w-auto" variant="outline" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

function CatalogueTab({ crecheId }: { crecheId: number }) {
  const { data: catalogue, isLoading } = useListCatalogue(crecheId);
  const createMutation = useCreateCatalogueItem(crecheId);
  const updateMutation = useUpdateCatalogueItem(crecheId);
  const deleteMutation = useDeleteCatalogueItem(crecheId);
  const { toast } = useToast();
  
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [historyItem, setHistoryItem] = useState<{ id: number; name: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: "",
    type: "product",
    description: "",
    price: "",
    stockQuantity: "",
    reorderThreshold: "",
    priceSmall: "",
    priceMedium: "",
    priceLarge: "",
    creditsAmount: "",
    maxPetsPerDay: "1",
    category: "",
    sku: "",
    barcode: "",
    costPrice: "",
    imageUrl: ""
  });

  const openEditModal = (item: any) => {
    setEditingId(item.id);
    setModalError(null);
    setForm({
      name: item.name,
      type: item.type,
      description: item.description || "",
      price: (item.basePrice / 100).toString(),
      stockQuantity: item.stockQuantity?.toString() || "",
      reorderThreshold: item.reorderThreshold != null ? item.reorderThreshold.toString() : "",
      priceSmall: item.pricingBySize?.small ? (item.pricingBySize.small / 100).toString() : "",
      priceMedium: item.pricingBySize?.medium ? (item.pricingBySize.medium / 100).toString() : "",
      priceLarge: item.pricingBySize?.large ? (item.pricingBySize.large / 100).toString() : "",
      creditsAmount: item.creditsAmount?.toString() || "",
      maxPetsPerDay: item.maxPetsPerDay?.toString() || "1",
      category: item.category || "",
      sku: item.sku || "",
      barcode: item.barcode || "",
      costPrice: item.costPrice ? (item.costPrice / 100).toString() : "",
      imageUrl: item.mediaUrls?.[0] || ""
    });
    setModalOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Tem certeza que deseja excluir este item do catálogo?")) {
      deleteMutation.mutate(id, {
        onSuccess: () => toast({ title: "Sucesso", description: "Item excluído com sucesso", variant: "default" }),
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    }
  };

  const handleSave = () => {
    if (!form.name || !form.price) {
      toast({ title: "Erro", description: "Nome e preço são obrigatórios", variant: "destructive" });
      return;
    }
    const rawPrice = form.price.trim();
    if (rawPrice === "") {
      toast({ title: "Erro", description: "Preço é obrigatório.", variant: "destructive" });
      return;
    }
    const priceCents = parseReaisInputToCents(rawPrice);
    if (priceCents === null || priceCents < 0) {
      toast({ title: "Erro", description: "Preço não pode ser negativo e deve ser monetário válido.", variant: "destructive" });
      return;
    }

    let costPriceCents: number | null = null;
    if (form.type === "product") {
      const rawCostPrice = form.costPrice.trim();
      if (rawCostPrice !== "") {
        costPriceCents = parseReaisInputToCents(rawCostPrice);
        if (costPriceCents === null || costPriceCents < 0) {
          toast({ title: "Erro", description: "Preço de custo monetário inválido.", variant: "destructive" });
          return;
        }
      }
    }

    let priceSmallCents: number | null = null;
    let priceMediumCents: number | null = null;
    let priceLargeCents: number | null = null;
    if (form.type === "service" || form.type === "day_use") {
      const rawSmall = form.priceSmall.trim();
      if (rawSmall !== "") {
        priceSmallCents = parseReaisInputToCents(rawSmall);
        if (priceSmallCents === null || priceSmallCents < 0) {
          toast({ title: "Erro", description: "Preço pequeno monetário inválido.", variant: "destructive" });
          return;
        }
      }
      const rawMedium = form.priceMedium.trim();
      if (rawMedium !== "") {
        priceMediumCents = parseReaisInputToCents(rawMedium);
        if (priceMediumCents === null || priceMediumCents < 0) {
          toast({ title: "Erro", description: "Preço médio monetário inválido.", variant: "destructive" });
          return;
        }
      }
      const rawLarge = form.priceLarge.trim();
      if (rawLarge !== "") {
        priceLargeCents = parseReaisInputToCents(rawLarge);
        if (priceLargeCents === null || priceLargeCents < 0) {
          toast({ title: "Erro", description: "Preço grande monetário inválido.", variant: "destructive" });
          return;
        }
      }
    }
    if (form.type === "package" && (!form.creditsAmount || parseInt(form.creditsAmount) <= 0)) {
      toast({ title: "Erro", description: "Informe a quantidade de diárias (créditos) do pacote", variant: "destructive" });
      return;
    }

    const payload = {
      name: form.name,
      type: form.type,
      description: form.description,
      price: priceCents,
      stockQuantity: form.type === "product" && form.stockQuantity ? parseInt(form.stockQuantity) : null,
      reorderThreshold: form.type === "product" && form.reorderThreshold !== "" ? parseInt(form.reorderThreshold) : null,
      creditsAmount: form.type === "package" && form.creditsAmount ? parseInt(form.creditsAmount) : null,
      maxPetsPerDay: form.type === "package" && form.maxPetsPerDay ? parseInt(form.maxPetsPerDay) : 1,
      pricingBySize: (form.type === "service" || form.type === "day_use") ? {
        small: priceSmallCents !== null ? priceSmallCents : priceCents,
        medium: priceMediumCents !== null ? priceMediumCents : priceCents,
        large: priceLargeCents !== null ? priceLargeCents : priceCents,
      } : undefined,
      category: form.category || null,
      sku: form.sku || null,
      barcode: form.barcode || null,
      costPrice: costPriceCents,
      mediaUrls: form.imageUrl ? [form.imageUrl] : []
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload }, {
        onSuccess: () => {
          setModalOpen(false);
          setEditingId(null);
          setModalError(null);
          setForm({ name: "", type: "product", description: "", price: "", stockQuantity: "", reorderThreshold: "", priceSmall: "", priceMedium: "", priceLarge: "", creditsAmount: "", maxPetsPerDay: "1", category: "", sku: "", barcode: "", costPrice: "", imageUrl: "" });
          toast({ title: "Sucesso", description: "Item atualizado no catálogo", variant: "default" });
        },
        onError: (err: any) => {
          setModalError(err.message || "Erro ao atualizar item do catálogo");
        }
      });
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => {
          setModalOpen(false);
          setModalError(null);
          setForm({ name: "", type: "product", description: "", price: "", stockQuantity: "", reorderThreshold: "", priceSmall: "", priceMedium: "", priceLarge: "", creditsAmount: "", maxPetsPerDay: "1", category: "", sku: "", barcode: "", costPrice: "", imageUrl: "" });
          toast({ title: "Sucesso", description: "Item adicionado ao catálogo", variant: "default" });
        },
        onError: (err: any) => {
          setModalError(err.message || "Erro ao criar item do catálogo");
        }
      });
    }
  };


  const lowStockItems = (catalogue || []).filter((item: any) =>
    item.type === "product" &&
    item.stockQuantity !== null &&
    item.reorderThreshold != null &&
    item.stockQuantity <= item.reorderThreshold
  );

  if (isLoading) return <div className="text-center p-12 text-muted-foreground">Carregando catálogo...</div>;
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <h3 className="text-lg font-medium text-foreground">Catálogo</h3>
          {lowStockItems.length > 0 && (
            <Badge variant="destructive" className="flex items-center gap-1.5 font-semibold">
              <ShieldAlert className="w-3.5 h-3.5" />
              {lowStockItems.length} {lowStockItems.length === 1 ? "com estoque baixo" : "com estoque baixo"}
            </Badge>
          )}
        </div>
        <Button onClick={() => {
          setEditingId(null);
          setModalError(null);
          setForm({ name: "", type: "product", description: "", price: "", stockQuantity: "", reorderThreshold: "", priceSmall: "", priceMedium: "", priceLarge: "", creditsAmount: "", maxPetsPerDay: "1", category: "", sku: "", barcode: "", costPrice: "", imageUrl: "" });
          setModalOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" /> Novo Item
        </Button>
      </div>

      {!catalogue || catalogue.length === 0 ? (
        <div className="text-center p-12 border border-dashed rounded-xl bg-muted/20">
          <PackageOpen className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-1">Nenhum item no catálogo</h3>
          <p className="text-muted-foreground">Adicione produtos e serviços para começar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {catalogue.map((item: any) => (
            <Card key={item.id} className="overflow-hidden group flex flex-col h-full bg-card shadow-sm border border-border">
              <div className="h-40 bg-muted relative flex items-center justify-center overflow-hidden shrink-0">
                {item.mediaUrls && item.mediaUrls.length > 0 ? (
                  <img src={buildMediaSrc(item.mediaUrls[0], getMediaToken())} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <PackageOpen className="h-10 w-10 text-muted-foreground opacity-30 group-hover:scale-110 transition-transform duration-300" />
                )}
                
                {item.type === "product" && item.stockQuantity !== null && item.reorderThreshold != null && item.stockQuantity <= item.reorderThreshold && (
                  <Badge variant="destructive" className="absolute top-2 right-2 shadow-sm font-bold">
                    Estoque Baixo
                  </Badge>
                )}
              </div>
              <CardContent className="p-4 flex-1 flex flex-col">
                <div className="flex justify-between items-start gap-2 mb-2">
                  <h4 className="font-semibold text-foreground leading-tight line-clamp-2">{item.name}</h4>
                  <Badge variant="outline" className="capitalize text-[10px] shrink-0 font-medium">
                    {item.type === 'package' ? 'Pacote' : 
                     item.type === 'day_use' ? 'Day Use' :
                     item.type === 'service' ? 'Serviço' : 'Produto'}
                  </Badge>
                </div>

                <div className="mt-auto pt-2 space-y-1">
                  {(item.type === "service" || item.type === "day_use") && (item.pricingBySize?.small || item.pricingBySize?.medium || item.pricingBySize?.large) ? (
                    <p className="text-lg font-bold text-primary flex items-baseline gap-1">
                      <span className="text-xs font-medium text-muted-foreground">A partir de</span>
                      {formatCentsToBRL(
                        Math.min(
                          Number(item.price),
                          Number(item.pricingBySize?.small || item.price),
                          Number(item.pricingBySize?.medium || item.price),
                          Number(item.pricingBySize?.large || item.price)
                        )
                      )}
                    </p>
                  ) : (
                    <p className="text-lg font-bold text-primary">{formatCentsToBRL(item.price)}</p>
                  )}

                  {item.type === "product" && (
                    <p className="text-xs text-muted-foreground">
                      Em estoque: <strong className="text-foreground">{item.stockQuantity ?? 'Ilimitado'}</strong>
                    </p>
                  )}
                  {item.type === "package" && item.creditsAmount && (
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-foreground">{item.creditsAmount} diárias</strong>
                      {item.maxPetsPerDay && item.maxPetsPerDay > 1 && (
                        <span className="ml-1 text-primary font-medium">(Até {item.maxPetsPerDay} pets/dia)</span>
                      )}
                    </p>
                  )}
                  {item.category && (
                    <p className="text-xs text-muted-foreground capitalize">
                      {item.category}
                    </p>
                  )}
                </div>

                <div className="pt-4 mt-4 border-t border-border flex items-center gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => openEditModal(item)}>
                    Editar
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" aria-label="Mais opções do item" className="px-2 w-9 h-9 shrink-0">
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {item.type === "product" && (
                        <DropdownMenuItem onClick={() => setHistoryItem({ id: item.id, name: item.name })}>
                          <Activity className="h-4 w-4 mr-2" /> Histórico
                        </DropdownMenuItem>
                      )}
                      {item.type === "product" && <DropdownMenuSeparator />}
                      <DropdownMenuItem onClick={() => handleDelete(item.id)} className="text-destructive focus:text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" /> Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {modalOpen && (
        <Modal isOpen={true} onClose={() => { setModalOpen(false); setModalError(null); }} title={editingId ? "Editar Item" : "Novo Item"} className="max-w-2xl">
          <div className="space-y-6">
            {editingId && (
              <CatalogueSmartIndicators crecheId={crecheId} itemId={editingId} type={form.type} />
            )}

            {modalError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive font-medium">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Nome <span className="text-destructive">*</span></label>
                <Input
                  value={form.name}
                  onChange={e => { setForm({...form, name: e.target.value}); setModalError(null); }}
                  placeholder="Ex: Ração Premium 10kg"
                  className="mt-1.5"
                />
                {!editingId && form.name.trim() && catalogue?.some((item: any) =>
                  item.name.trim().toLowerCase() === form.name.trim().toLowerCase()
                ) && (
                  <p className="mt-1.5 text-xs text-warning flex items-center gap-1 font-medium">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Já existe um item com este nome.
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium">Tipo</label>
                <select 
                  className="w-full bg-background border border-input rounded-md h-10 px-3 text-sm mt-1.5 text-foreground focus:ring-2 focus:ring-ring outline-none"
                  value={form.type} 
                  onChange={e => setForm({...form, type: e.target.value})}
                >
                  <option value="product">Produto</option>
                  <option value="service">Serviço</option>
                  <option value="day_use">Day Use</option>
                  <option value="package">Pacote de Diárias</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">Categoria</label>
                <Input value={form.category} onChange={e => setForm({...form, category: e.target.value})} placeholder="Ex: Rações, Banho" className="mt-1.5" />
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Preço Base (R$) <span className="text-destructive">*</span></label>
                <Input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({...form, price: e.target.value})} placeholder="0,00" className="mt-1.5 font-medium" />
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Descrição</label>
                <textarea 
                  value={form.description} 
                  onChange={e => setForm({...form, description: e.target.value})} 
                  className="w-full bg-background border border-input rounded-md p-3 text-sm min-h-[80px] mt-1.5 resize-y focus:ring-2 focus:ring-ring outline-none"
                  placeholder="Detalhes opcionais do item..." 
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Foto do Item</label>
                <input
                  ref={imageFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setImageUploading(true);
                    try {
                      const token = localStorage.getItem("auth_token") ?? "";
                      const objectPath = await uploadFileDirect(file, token);
                      setForm(f => ({ ...f, imageUrl: objectPath }));
                    } catch (err: any) {
                      toast({ title: "Erro no upload", description: err.message || "Não foi possível enviar a imagem.", variant: "destructive" });
                    } finally {
                      setImageUploading(false);
                      if (imageFileRef.current) imageFileRef.current.value = "";
                    }
                  }}
                />
                <div className="flex items-center gap-3 mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={imageUploading}
                    onClick={() => imageFileRef.current?.click()}
                  >
                    <Camera className="h-4 w-4" />
                    {imageUploading ? "Enviando…" : "Selecionar foto"}
                  </Button>
                  {form.imageUrl && (
                    <div className="flex items-center gap-2 flex-1 min-w-0 bg-muted/50 p-1.5 rounded-md border border-border">
                      <img
                        src={buildMediaSrc(form.imageUrl, getMediaToken())}
                        alt="preview"
                        className="h-8 w-8 rounded object-cover shrink-0"
                        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <span className="text-xs text-muted-foreground truncate" title={form.imageUrl}>{form.imageUrl.split("/").pop()}</span>
                      <button
                        type="button"
                        className="text-xs text-destructive hover:text-destructive/80 shrink-0 font-medium ml-auto px-2"
                        onClick={() => setForm(f => ({ ...f, imageUrl: "" }))}
                      >
                        Remover
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {form.type === "product" && (
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground">Controle de Estoque</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Preço de Custo (R$)</label>
                    <Input type="number" min="0" step="0.01" value={form.costPrice} onChange={e => setForm({...form, costPrice: e.target.value})} placeholder="Opcional" className="mt-1.5" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Estoque (opcional)</label>
                    <Input type="number" min="0" value={form.stockQuantity} onChange={e => setForm({...form, stockQuantity: e.target.value})} placeholder="Quantidade atual" className="mt-1.5" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Ponto de Reposição</label>
                    <Input type="number" min="0" value={form.reorderThreshold} onChange={e => setForm({...form, reorderThreshold: e.target.value})} placeholder="Ex: 5" className="mt-1.5" />
                    <p className="text-[11px] text-muted-foreground mt-1">Alerte quando o estoque chegar aqui.</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Código de Barras</label>
                    <Input value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} placeholder="Ex: 7891000..." className="mt-1.5" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">SKU (opcional)</label>
                    <Input value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} placeholder="Código interno" className="mt-1.5" />
                  </div>
                </div>
              </div>
            )}

            {form.type === "package" && (
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground">Regras do Pacote</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Diárias (Créditos) <span className="text-destructive">*</span></label>
                    <Input type="number" min="1" value={form.creditsAmount} onChange={e => setForm({...form, creditsAmount: e.target.value})} placeholder="Ex: 20" className="mt-1.5" />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      O tutor receberá este número de diárias.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Limite de Pets por Diária</label>
                    <Input type="number" min="1" value={form.maxPetsPerDay} onChange={e => setForm({...form, maxPetsPerDay: e.target.value})} placeholder="Ex: 1" className="mt-1.5" />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Deixe 1 para pacotes normais.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {(form.type === "service" || form.type === "day_use") && (
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground">Preços por Porte</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium">Pequeno</label>
                    <Input type="number" min="0" step="0.01" value={form.priceSmall} onChange={e => setForm({...form, priceSmall: e.target.value})} placeholder="Padrão" className="mt-1 h-9 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Médio</label>
                    <Input type="number" min="0" step="0.01" value={form.priceMedium} onChange={e => setForm({...form, priceMedium: e.target.value})} placeholder="Padrão" className="mt-1 h-9 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Grande</label>
                    <Input type="number" min="0" step="0.01" value={form.priceLarge} onChange={e => setForm({...form, priceLarge: e.target.value})} placeholder="Padrão" className="mt-1 h-9 text-sm" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Se não informados, o porte usará o Preço Base do item.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <Button variant="outline" onClick={() => { setModalOpen(false); setModalError(null); }} type="button">
                Cancelar
              </Button>
              <Button onClick={handleSave} isLoading={createMutation.isPending || updateMutation.isPending} className="min-w-[120px]">
                Salvar Item
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {historyItem && (
        <StockHistoryModal
          crecheId={crecheId}
          itemId={historyItem.id}
          itemName={historyItem.name}
          onClose={() => setHistoryItem(null)}
        />
      )}
    </div>
  );
}

function DefaultersTab({ crecheId }: { crecheId: number }) {
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
    { accessorKey: "tutorName", header: "Tutor", cell: (info: any) => <span className="font-medium text-white">{info.getValue() || "Desconhecido"}</span> },
    { accessorKey: "dueDate", header: "Vencimento", cell: (info: any) => info.getValue() ? format(parseLocalDate(info.getValue()), "dd/MM/yyyy", { locale: ptBR }) : "—" },
    { accessorKey: "amount", header: "Valor", meta: { exportValue: (v: any) => formatCentsToBRL(Number(v)) }, cell: (info: any) => <span className="font-medium text-white">{formatCentsToBRL(info.getValue())}</span> },
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
            <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-white" onClick={() => handleVoid(inv.id)} disabled={voidMutation.isPending}>
              Cancelar
            </Button>
            <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-400/20 hover:bg-emerald-400/10" onClick={() => window.open(`https://wa.me/?text=${msg}`, '_blank')}>
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
      <Card className="bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20">
        <CardContent className="p-6">
          <h3 className="text-sm font-medium text-red-400 mb-2">Total em Inadimplência</h3>
          <p className="text-3xl font-display font-bold text-white">
            {formatCentsToBRL(totalDefaulters)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
            <h3 className="font-medium text-white">Faturas Inadimplentes</h3>
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


function ReceiptsTab({ crecheId }: { crecheId: number }) {
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
        <h3 className="font-medium text-white mb-6">Comprovantes Pendentes de Aprovação</h3>
        {/* ── MOBILE CARD VIEW ──────────────────────────────── */}
        <div className="md:hidden divide-y divide-white/5">
          {pendingReceipts.length > 0 ? (
            pendingReceipts.map((inv: any) => (
              <div key={inv.id} className="p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <p className="font-semibold text-white">{inv.tutorName || "Desconhecido"}</p>
                  <p className="font-bold text-white">{formatCentsToBRL(inv.amount)}</p>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Vencimento:</span>
                  <span className="text-white">{inv.dueDate ? format(new Date(inv.dueDate), "dd/MM/yyyy", { locale: ptBR }) : "—"}</span>
                </div>
                <div className="flex gap-2 pt-2 border-t border-white/5">
                  {inv.receiptPhotoPath && (
                    <Button variant="ghost" size="sm" onClick={() => {
                      setPreviewUrl(buildMediaSrc(inv.receiptPhotoPath, getMediaToken()));
                    }} className="flex-1 text-blue-400 hover:text-blue-300 hover:bg-blue-400/10">
                      Ver Comprovante
                    </Button>
                  )}
                  <Button size="sm" onClick={() => handleApproveReceipt(inv.id)} disabled={approveReceiptMutation.isPending} className="flex-1 bg-emerald-500 hover:bg-emerald-600">
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
            <thead className="text-xs text-muted-foreground bg-black/20 uppercase">
              <tr>
                <th className="px-6 py-4 font-medium">Tutor</th>
                <th className="px-6 py-4 font-medium">Vencimento</th>
                <th className="px-6 py-4 font-medium">Valor</th>
                <th className="px-6 py-4 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pendingReceipts.length > 0 ? (
                pendingReceipts.map((inv: any) => (
                  <tr key={inv.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 font-medium text-white">{inv.tutorName || "Desconhecido"}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {inv.dueDate ? format(parseLocalDate(inv.dueDate), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                    </td>
                    <td className="px-6 py-4 text-white font-medium">{formatCentsToBRL(inv.amount)}</td>
                    <td className="px-6 py-4 text-right space-x-2">
                      {inv.receiptPhotoPath && (
                        <Button variant="ghost" size="sm" onClick={() => {
                          setPreviewUrl(buildMediaSrc(inv.receiptPhotoPath, getMediaToken()));
                        }} className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10">
                          Ver Comprovante
                        </Button>
                      )}
                      <Button size="sm" onClick={() => handleApproveReceipt(inv.id)} disabled={approveReceiptMutation.isPending} className="bg-emerald-500 hover:bg-emerald-600">
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

function OrdersTab({ crecheId }: { crecheId: number }) {
  const { data: orders, isLoading } = useListOrders(crecheId);
  const updateStatus = useUpdateOrderStatus(crecheId);
  const approveReceipt = useApproveReceipt(crecheId);
  const { toast } = useToast();
  
  const [confirmModal, setConfirmModal] = React.useState<{isOpen: boolean, orderId: number, nextStatus: string, order: any} | null>(null);


  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'pending_payment': return <Badge variant="outline" className="text-warning border-warning/20 bg-warning/10">Pendente</Badge>;
      case 'paid': return <Badge variant="outline" className="text-success border-success/20 bg-success/10">Pago</Badge>;
      case 'preparing': return <Badge variant="outline" className="text-primary border-primary/20 bg-primary/10">Separando</Badge>;
      case 'ready_for_pickup': return <Badge variant="outline" className="text-primary border-primary/20 bg-primary/10">Pronto p/ Retirada</Badge>;
      case 'delivering': return <Badge variant="outline" className="text-primary border-primary/20 bg-primary/10">Em Rota</Badge>;
      case 'delivered': return <Badge variant="outline" className="text-muted-foreground border-border bg-muted">Entregue</Badge>;
      case 'cancelled': return <Badge variant="outline" className="text-destructive border-destructive/20 bg-destructive/10">Cancelado</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleUpdateStatus = (orderId: number, status: string, order: any) => {
    // Se a fatura ainda estiver pendente e estamos avançando o status do pedido
    if (order.invoiceStatus === 'pending' && status !== 'cancelled' && status !== 'pending_payment') {
      setConfirmModal({ isOpen: true, orderId, nextStatus: status, order });
      return;
    }
    
    executeStatusUpdate(orderId, status);
  };

  const executeStatusUpdate = (orderId: number, status: string) => {
    updateStatus.mutate({ orderId, status }, {
      onSuccess: () => toast({ title: "Status do pedido atualizado" }),
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const handleConfirmWithPayment = () => {
    if (!confirmModal) return;
    
    // 1. Aprova a fatura financeira
    approveReceipt.mutate(confirmModal.order.invoiceId, {
      onSuccess: () => {
        toast({ title: "Pagamento confirmado", description: "Fatura baixada e diárias liberadas (se houver)." });
        // 2. Atualiza o status do pedido logístico
        executeStatusUpdate(confirmModal.orderId, confirmModal.nextStatus);
        setConfirmModal(null);
      },
      onError: (err: any) => {
        toast({ title: "Erro ao confirmar pagamento", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleConfirmWithoutPayment = () => {
    if (!confirmModal) return;
    executeStatusUpdate(confirmModal.orderId, confirmModal.nextStatus);
    setConfirmModal(null);
  };

  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando pedidos...</div>;
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-medium text-foreground">Pedidos da Loja</h3>
      </div>
      
      <div className="overflow-y-auto max-h-[70vh] pr-1 grid grid-cols-1 md:grid-cols-2 gap-4 custom-scrollbar">
        {orders?.length === 0 && <p className="text-muted-foreground col-span-full text-center py-8">Nenhum pedido encontrado.</p>}
        {orders?.map((order: any) => (
          <Card key={order.id} className="bg-card border-border shadow-sm flex flex-col">
            <CardContent className="p-4 flex flex-col h-full">
              
              <div className="flex justify-between items-start gap-2 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-bold text-foreground text-lg">#{order.id}</h4>
                  {getStatusBadge(order.status)}
                  <Badge variant="secondary" className="bg-muted text-muted-foreground border-border">
                    {order.deliveryMethod === 'delivery' ? 'Entrega' : 'Retirada'}
                  </Badge>
                </div>
              </div>
              
              <div className="space-y-1 mb-4">
                <p className="text-sm text-foreground font-medium flex items-center gap-2">
                  <span className="text-muted-foreground">Tutor:</span> {order.tutor?.name} {order.tutor?.phone && <span className="text-muted-foreground font-normal">({order.tutor?.phone})</span>}
                </p>
                {order.deliveryMethod === 'delivery' && (
                  <p className="text-sm text-foreground flex items-start gap-2">
                    <span className="text-muted-foreground shrink-0">Endereço:</span>
                    <span className="leading-tight">{order.deliveryAddress}</span>
                  </p>
                )}
              </div>
              
              <div className="bg-muted/30 rounded-xl border border-border p-3 mb-4 space-y-2">
                {order.items?.map((item: any, idx: number) => (
                  <div key={idx} className="flex justify-between items-center text-sm">
                    <span className="text-foreground">
                      <span className="font-semibold text-muted-foreground mr-1">{item.quantity}x</span> 
                      {item.name}
                    </span>
                    <span className="text-muted-foreground font-medium">{formatCentsToBRL(item.totalPrice)}</span>
                  </div>
                ))}
                
                <div className="pt-2 mt-2 border-t border-border/50 flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Frete</span>
                  <span className="text-sm text-muted-foreground">{formatCentsToBRL(order.deliveryFee)}</span>
                </div>
              </div>

              <div className="mt-auto flex flex-col space-y-4">
                <div className="flex justify-between items-end border-t border-border pt-4">
                  <span className="text-muted-foreground font-medium">Total</span>
                  <span className="text-2xl font-bold text-foreground tracking-tight">{formatCentsToBRL(order.total)}</span>
                </div>
                
                <div className="flex gap-2 flex-wrap items-center">
                  {order.status === 'pending_payment' && (
                    <>
                      <Button className="h-11 flex-1 sm:flex-none" onClick={() => handleUpdateStatus(order.id, 'paid', order)}>
                        Confirmar Pagamento
                      </Button>
                      <Button variant="destructive" className="h-11 flex-1 sm:flex-none" onClick={() => handleUpdateStatus(order.id, 'cancelled', order)}>
                        Cancelar
                      </Button>
                    </>
                  )}
                  {order.status === 'paid' && (
                    <Button className="h-11 flex-1 sm:flex-none" onClick={() => handleUpdateStatus(order.id, 'preparing', order)}>
                      Iniciar Separação
                    </Button>
                  )}
                  {order.status === 'preparing' && (
                    <Button className="h-11 flex-1 sm:flex-none" onClick={() => handleUpdateStatus(order.id, order.deliveryMethod === 'delivery' ? 'delivering' : 'ready_for_pickup', order)}>
                      {order.deliveryMethod === 'delivery' ? 'Saiu p/ Entrega' : 'Pronto p/ Retirada'}
                    </Button>
                  )}
                  {(order.status === 'delivering' || order.status === 'ready_for_pickup') && (
                    <Button className="h-11 flex-1 sm:flex-none bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => handleUpdateStatus(order.id, 'delivered', order)}>
                      Marcar Entregue
                    </Button>
                  )}
                </div>
              </div>
              
            </CardContent>
          </Card>
        ))}
      </div>

      <Modal isOpen={confirmModal?.isOpen || false} onClose={() => setConfirmModal(null)} title="Fatura em Aberto ⚠️" description={`Este pedido possui uma fatura pendente no valor de ${formatCentsToBRL(confirmModal?.order?.invoiceAmount || 0)}. O tutor já realizou o pagamento no balcão/Pix?`}>
          <div className="flex flex-col gap-3 mt-4">
            <Button onClick={handleConfirmWithPayment} className="h-11 w-full justify-start">
              <CheckCircle className="mr-2 h-4 w-4" /> Sim, confirmar pagamento e dar baixa na fatura
            </Button>
            <Button variant="outline" onClick={handleConfirmWithoutPayment} className="h-11 w-full justify-start border-border hover:bg-muted text-foreground">
              <Clock className="mr-2 h-4 w-4 text-warning" /> Não, vai pagar depois (manter fatura aberta)
            </Button>
            <Button variant="ghost" onClick={() => setConfirmModal(null)} className="h-11 w-full text-muted-foreground hover:text-foreground">
              Cancelar alteração
            </Button>
          </div>
      </Modal>
    </div>
  );
}

function FinancialDashboardContent() {
  const { user } = useAuth();
  const crecheId = user?.crecheId as number;
  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const activeTab = urlParams.get("tab") || "cashflow";
  const [location, navigate] = useLocation();
  const [isPosModalOpen, setIsPosModalOpen] = useState(false);
  const { startDate, endDate, setStartDate, setEndDate } = useFinancialContext();

  const handleTabChange = (value: string) => {
    navigate(`${location}?tab=${value}`, { replace: true });
  };

  const TAB_GROUPS = [
    {
      id: "operacional",
      label: "Operacional",
      items: [
        { id: "cashflow", label: "Movimentações", icon: <BarChart3 className="h-4 w-4" />, content: <CashFlowTab crecheId={crecheId} /> },
        { id: "receivables", label: "A Receber", icon: <Receipt className="h-4 w-4" />, content: <ReceivablesTab crecheId={crecheId} /> },
        { id: "defaulters", label: "Inadimplência", icon: <FileText className="h-4 w-4 text-red-400" />, content: <DefaultersTab crecheId={crecheId} /> },
        { id: "payables", label: "A Pagar", icon: <FileText className="h-4 w-4" />, content: <PayablesTab crecheId={crecheId} /> },
        { id: "reports", label: "Central de Relatórios", icon: <FileText className="h-4 w-4" />, content: <ReportsCentralTab crecheId={crecheId} /> }
      ]
    },
    {
      id: "gestao",
      label: "Gestão e Controles",
      items: [
        { id: "catalogue", label: "Catálogo", icon: <PackageOpen className="h-4 w-4" />, content: <CatalogueTab crecheId={crecheId} /> },
        { id: "orders", label: "Pedidos (Loja)", icon: <ShoppingBag className="h-4 w-4 text-emerald-400" />, content: <OrdersTab crecheId={crecheId} /> },
        { id: "receipts", label: "Comprovantes", icon: <Camera className="h-4 w-4" />, content: <ReceiptsTab crecheId={crecheId} /> },
        { id: "audit", label: "Auditoria", icon: <ShieldAlert className="h-4 w-4 text-orange-400" />, content: <AuditTab crecheId={crecheId} /> }
      ]
    }
  ];

  const activeTabId = urlParams.get('tab') || 'reports';
  
  let activeContent: React.ReactNode = null;
  let activeGroupId: string | null = null;
  
  TAB_GROUPS.forEach(g => {
    g.items.forEach(i => {
      if (i.id === activeTabId) {
        activeContent = i.content;
        activeGroupId = g.id;
      }
    });
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col lg:flex-row justify-between lg:items-center items-start gap-4">
        <PageHeader 
          title="Financeiro" 
          description="Gestão de faturamento, despesas e fluxo de caixa." 
          icon={CircleDollarSign} 
        />
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:space-x-4 w-full lg:w-auto">
          <div className="flex flex-row items-center gap-2 w-full sm:w-auto">
            <DateFilterPopover
              start={startDate}
              end={endDate}
              onChangeStart={setStartDate}
              onChangeEnd={setEndDate}
            />
            <div className="flex-1 min-w-0">
              <CommandPalette crecheId={crecheId} />
            </div>
          </div>
          <Button onClick={() => setIsPosModalOpen(true)} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold shadow-sm transition-all hover:shadow-md w-full sm:w-auto">
            <ShoppingCart className="mr-2 h-4 w-4 shrink-0" /> Venda Balcão (PDV)
          </Button>
        </div>
      </div>

      {isPosModalOpen && (
        <POSSaleModal isOpen={true} onClose={() => setIsPosModalOpen(false)} crecheId={crecheId} />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4 border-b border-white/10 pb-4">
        {TAB_GROUPS.map(group => {
          const isActiveGroup = activeGroupId === group.id;
          const activeItemInGroup = group.items.find(i => i.id === activeTabId);

          return (
            <DropdownMenu key={group.id}>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant={isActiveGroup ? "outline" : "ghost"} 
                  className={`w-full sm:w-auto justify-between sm:justify-center ${isActiveGroup ? 'bg-primary/20 text-primary hover:bg-primary/30 border-primary/50' : 'text-muted-foreground'}`}
                >
                  <span className="font-semibold">{group.label}</span>
                  {isActiveGroup && activeItemInGroup && (
                    <>
                      <span className="mx-2 opacity-50">-</span>
                      <span className="font-normal">{activeItemInGroup.label}</span>
                    </>
                  )}
                  <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-zinc-950 border-white/10">
                {group.items.map(item => (
                  <DropdownMenuItem 
                    key={item.id} 
                    onClick={() => handleTabChange(item.id)}
                    className={`cursor-pointer ${item.id === activeTabId ? 'bg-white/10 text-white' : 'text-muted-foreground hover:text-white'}`}
                  >
                    {item.icon}
                    <span className="ml-2">{item.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>
      
      <div className="pt-2 relative flex-1">
        {activeContent}
      </div>
    </div>
  );
}

import { ThermalReceiptModal } from "@/components/modals/ThermalReceiptModal";
import { formatCentsToBRL, parseReaisInputToCents } from "@/lib/money";

export default function FinancialDashboard() {
  return (
    <FinancialProvider>
      <FinancialDashboardContent />
    </FinancialProvider>
  );
}
