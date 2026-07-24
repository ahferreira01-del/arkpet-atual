import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { Camera, ShieldAlert, BarChart3, Receipt, FileText, PackageOpen, ShoppingBag, Plus, MoreHorizontal, CircleDollarSign, ShoppingCart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AdvancedDataTable } from "../../components/ui/advanced-data-table";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { useListAuditLogs, useDashboardCashFlow, useListAllInvoices, useListExpenses, useListCatalogue, useCreateExpense, usePayExpense, useDashboardDre, useRefundInvoice, useVoidInvoice, useCreateCatalogueItem, usePayManualInvoice, useApproveReceipt, useUpdateExpense, useDeleteExpense, useUpdateCatalogueItem, useDeleteCatalogueItem, useCreche, useUpdateCrecheSettings, useInvoiceItems, useListOrders, useUpdateOrderStatus, useRefundInvoiceItem } from "@/hooks/use-financial";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useSearch, useLocation } from "wouter";
import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { POSSaleModal } from "@/components/financial/pos-sale-modal";
import { ExecutiveDashboardTab, SalesDashboardTab, ReportsCentralTab } from "./dashboards";
import { LayoutDashboard, Activity, ArrowRight, ChevronDown, CheckCircle, Clock } from "lucide-react";
import { CommandPalette } from "@/components/financial/command-palette";
import { CatalogueSmartIndicators } from "@/components/financial/smart-indicators";
import { FinancialProvider, useFinancialContext } from "@/components/financial/financial-context";

function formatBRL(value: number) {
  return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function CashFlowTab({ crecheId }: { crecheId: number }) {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const { toast } = useToast();

  const handleDateChange = (type: "start" | "end", val: string) => {
    const s = type === "start" ? new Date(val) : new Date(startDate);
    const e = type === "end" ? new Date(val) : new Date(endDate);
    if (e.getTime() - s.getTime() > 366 * 24 * 60 * 60 * 1000) {
      toast({ title: "Erro", description: "O intervalo máximo é de 1 ano.", variant: "destructive" });
      return;
    }
    if (type === "start") setStartDate(val);
    else setEndDate(val);
  };

  const { data: cashFlow, isLoading } = useDashboardCashFlow(crecheId, startDate, endDate);
  const { data: dre } = useDashboardDre(crecheId, startDate, endDate);


  const totalIncome = Array.isArray(cashFlow) ? cashFlow.filter((c: any) => c.type === 'income').reduce((sum: number, c: any) => sum + Number(c.total), 0) : 0;
  const totalExpenses = Array.isArray(cashFlow) ? cashFlow.filter((c: any) => c.type === 'expense').reduce((sum: number, c: any) => sum + Number(c.total), 0) : 0;

  const chartDataMap = new Map<string, { date: string; Entradas: number; Saídas: number }>();
  if (Array.isArray(cashFlow)) {
    cashFlow.forEach((c: any) => {
      const dateStr = format(new Date(c.date), "dd/MM");
      if (!chartDataMap.has(dateStr)) {
        chartDataMap.set(dateStr, { date: dateStr, Entradas: 0, Saídas: 0 });
      }
      const existing = chartDataMap.get(dateStr)!;
      if (c.type === 'income') existing.Entradas += Number(c.total);
      if (c.type === 'expense') existing.Saídas += Number(c.total);
    });
  }
  const chartData = Array.from(chartDataMap.values());

  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando fluxo de caixa...</div>;
  return (
    <div className="space-y-6">
        <DateFilterPopover 
          start={startDate}
          end={endDate}
          onChangeStart={(val) => handleDateChange("start", val)}
          onChangeEnd={(val) => handleDateChange("end", val)}
        />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-emerald-400 mb-2">Entradas</h3>
            <p className="text-3xl font-display font-bold text-white">
              {formatBRL(totalIncome)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-red-400 mb-2">Saídas</h3>
            <p className="text-3xl font-display font-bold text-white">
              {formatBRL(totalExpenses)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-500/10 to-transparent border-blue-500/20">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-blue-400 mb-2">Saldo Líquido</h3>
            <p className="text-3xl font-display font-bold text-white">
              {formatBRL(totalIncome - totalExpenses)}
            </p>
          </CardContent>
        </Card>
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-display font-semibold mb-6">Evolução Diária</h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
                  <XAxis dataKey="date" stroke="rgba(255,255,255,0.5)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.5)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `R$ ${value}`} />
                  <RechartsTooltip 
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }} 
                    contentStyle={{ backgroundColor: '#18181b', borderColor: 'rgba(255,255,255,0.1)', color: '#fff', borderRadius: '8px' }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar dataKey="Entradas" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="Saídas" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}


    </div>
  );
}

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
      case 'void': return 'bg-slate-100 text-slate-800 border-slate-200';
      case 'refunded': return 'bg-purple-100 text-purple-800 border-purple-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'paid': return 'Paga';
      case 'pending': return 'Pendente';
      case 'overdue': return 'Atrasada';
      case 'void': return 'Cancelada';
      case 'refunded': return 'Estornada';
      default: return status;
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`Fatura #${invoiceId} - Visão Executiva`} className="max-w-4xl">
      <div className="space-y-6 text-foreground">
        
        {/* Executive Header */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-card rounded-lg border shadow-sm">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Tutor / Cliente</p>
            <p className="text-sm font-semibold truncate">{tutorName}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">Data de Emissão</p>
            <p className="text-sm font-semibold">{new Date(issueDate).toLocaleDateString('pt-BR')}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">Status da Fatura</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getStatusColor(invoiceStatus)}`}>
              {getStatusLabel(invoiceStatus)}
            </span>
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium">Valor Total</p>
            <p className="text-lg font-bold text-emerald-500">{formatBRL(total)}</p>
          </div>
        </div>

        {/* Timeline */}
        <div className="p-4 bg-card rounded-lg border shadow-sm">
          <h4 className="text-sm font-bold text-card-foreground mb-4">Linha do Tempo (Timeline)</h4>
          <div className="flex items-center justify-between relative">
            <div className="absolute top-1/2 left-0 w-full h-0.5 bg-muted -z-10 -translate-y-1/2"></div>
            
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center border-4 border-card shadow-sm z-10">
                <FileText className="w-4 h-4" />
              </div>
              <p className="text-xs font-medium mt-2 text-card-foreground">Criada</p>
            </div>
            
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center border-4 border-card shadow-sm z-10">
                <Receipt className="w-4 h-4" />
              </div>
              <p className="text-xs font-medium mt-2 text-card-foreground">Enviada</p>
            </div>

            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-4 border-card shadow-sm z-10 ${invoiceStatus === 'paid' ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'}`}>
                <CircleDollarSign className="w-4 h-4" />
              </div>
              <p className={`text-xs font-medium mt-2 ${invoiceStatus === 'paid' ? 'text-card-foreground' : 'text-muted-foreground'}`}>Paga</p>
            </div>

            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-4 border-card shadow-sm z-10 ${invoiceStatus === 'refunded' ? 'bg-purple-500 text-white' : 'bg-muted text-muted-foreground'}`}>
                <ArrowRight className="w-4 h-4" />
              </div>
              <p className={`text-xs font-medium mt-2 ${invoiceStatus === 'refunded' ? 'text-card-foreground' : 'text-muted-foreground'}`}>Estornada</p>
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
                return (
                  <div key={item.id} className="py-3 flex justify-between items-center group">
                    <div className="flex items-center">
                      <div className="w-10 h-10 rounded bg-slate-100 flex items-center justify-center mr-3">
                        <PackageOpen className="w-5 h-5 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-800">{item.description}</p>
                        <p className="text-xs text-slate-500">
                          {qty} unidade(s) x {formatBRL(unitPrice)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm font-bold text-slate-800">
                      {formatBRL(lineTotal)}
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
                            onSuccess: () => alert("Estorno/Devolução realizado com sucesso.")
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
  
  const [payModal, setPayModal] = useState<{open: boolean, invoiceId: number | null}>({ open: false, invoiceId: null });
  const [detailsModal, setDetailsModal] = useState<{open: boolean, invoiceId: number | null}>({ open: false, invoiceId: null });
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

  const handleViewReceipt = async (id: number) => {
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${id}/receipt-url`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Comprovante não encontrado");
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const invoiceList = invoicesData?.data || (Array.isArray(invoicesData) ? invoicesData : []);

  const columns = React.useMemo(() => [
    { accessorKey: "tutorName", header: "Tutor", cell: (info: any) => info.getValue() || "Desconhecido" },
    { accessorKey: "createdAt", header: "Emissão", cell: (info: any) => info.getValue() ? format(new Date(info.getValue()), "dd/MM/yyyy", { locale: ptBR }) : "—" },
    { accessorKey: "dueDate", header: "Vencimento", cell: (info: any) => {
        const val = info.getValue();
        const inv = info.row.original;
        const isOverdue = val && ['pending', 'overdue'].includes(inv.status) && new Date(val).getTime() < new Date().setHours(0,0,0,0);
        return <span className={isOverdue ? "text-red-400 font-medium" : ""}>{val ? format(new Date(val), "dd/MM/yyyy", { locale: ptBR }) : "—"}</span>;
    } },
    { accessorKey: "amount", header: "Valor", cell: (info: any) => formatBRL(info.getValue()) },
    { accessorKey: "status", header: "Status", cell: (info: any) => {
        const status = info.getValue();
        return (
          <Badge variant={status === "paid" ? "success" : status === "awaiting_confirmation" ? "default" : status === "refunded" ? "outline" : status === "void" ? "secondary" : status === "overdue" ? "destructive" : "secondary"}>
            {status === "paid" ? "Pago" : status === "awaiting_confirmation" ? "Em Análise" : status === "refunded" ? "Estornado" : status === "void" ? "Cancelado" : status === "overdue" ? "Atrasado" : "Pendente"}
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
              <Button variant="ghost" size="sm" onClick={() => handleViewReceipt(inv.id)} className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10">
                Ver Comprovante
              </Button>
            )}
            {inv.status === "awaiting_confirmation" && (
              <Button variant="ghost" size="sm" onClick={() => handleApproveReceipt(inv.id)} disabled={approveReceiptMutation.isPending} className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10">
                Aprovar
              </Button>
            )}
            {inv.status === "paid" && (
              <Button variant="ghost" size="sm" onClick={() => handleRefund(inv.id)} disabled={refundMutation.isPending} className="text-red-400 hover:text-red-300 hover:bg-red-400/10">
                Estornar
              </Button>
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
            />
          </div>
        </CardContent>
      </Card>
      
      {payModal.open && (
        <Modal isOpen={true} onClose={() => setPayModal({ open: false, invoiceId: null })} title="Dar Baixa Manual">
          <div className="space-y-4">
            <div>
              <label className="text-sm">Método de Pagamento</label>
              <select 
                className="w-full bg-white/5 border border-white/10 rounded-md h-10 px-3 text-sm mt-1"
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
              >
                <option value="pix" className="bg-zinc-900">Pix</option>
                <option value="cash" className="bg-zinc-900">Dinheiro</option>
                <option value="credit_card" className="bg-zinc-900">Cartão de Crédito/Débito (Maquininha)</option>
                <option value="bank_slip" className="bg-zinc-900">Boleto (Externo)</option>
              </select>
            </div>
            <Button onClick={handlePayManual} isLoading={payManualMutation.isPending} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white">
              Confirmar Recebimento
            </Button>
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
    const val = parseFloat(form.amount);
    if (isNaN(val) || val < 0) {
      toast({ title: "Erro", description: "O valor deve ser positivo.", variant: "destructive" });
      return;
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...form, amount: val }, {
        onSuccess: () => {
          toast({ title: "Sucesso", description: "Despesa atualizada com sucesso." });
          setModalOpen(false);
          setEditingId(null);
          setForm({ description: "", category: "operacional", amount: "", dueDate: "" });
        },
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    } else {
      createMutation.mutate({ ...form, amount: val }, {
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
    { accessorKey: "description", header: "Descrição", cell: (info: any) => info.getValue() },
    { accessorKey: "category", header: "Categoria", cell: (info: any) => <span className="capitalize">{info.getValue()}</span> },
    { accessorKey: "dueDate", header: "Data", cell: (info: any) => {
        const d = info.getValue() || info.row.original.date || new Date();
        return format(new Date(d), "dd/MM/yyyy", { locale: ptBR });
    } },
    { accessorKey: "amount", header: "Valor", cell: (info: any) => <span className="text-red-400 font-medium">-{formatBRL(info.getValue())}</span> },
    { accessorKey: "isPaid", header: "Status", cell: (info: any) => {
        return info.getValue() 
          ? <Badge variant="default" className="bg-emerald-500/10 text-emerald-500">Pago</Badge> 
          : <Badge variant="default" className="bg-white/10 text-white">Pendente</Badge>;
    } },
    {
      id: "actions",
      header: () => <div className="text-right">Ação</div>,
      cell: ({ row }: any) => {
        const exp = row.original;
  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando despesas...</div>;
        return (
          <div className="flex justify-end space-x-2 gap-1">
            {!exp.isPaid && (
              <Button size="sm" onClick={() => handlePay(exp.id)} isLoading={payMutation.isPending} className="bg-emerald-500 hover:bg-emerald-600">
                Pagar
              </Button>
            )}
            <Button size="sm" variant="default" className="bg-white/10 text-white" onClick={() => openEditModal(exp)}>
              Editar
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleDelete(exp.id)} isLoading={deleteMutation.isPending}>
              Excluir
            </Button>
          </div>
        );
      }
    }
  ], [payMutation.isPending, deleteMutation.isPending]);

  return (
    <>
    <Card>
      <CardContent className="p-0">
        <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
          <h3 className="font-medium text-white">Despesas Registradas</h3>
          <Button size="sm" onClick={() => {
            setEditingId(null);
            setForm({ description: "", category: "operacional", amount: "", dueDate: "" });
            setModalOpen(true);
          }}>
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
          />
        </div>
      </CardContent>
    </Card>
{modalOpen && (
      <Modal isOpen={true} onClose={() => setModalOpen(false)} title={editingId ? "Editar Despesa" : "Nova Despesa"}>
        <div className="space-y-4">
          <div>
            <label className="text-sm">Descrição *</label>
            <Input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Ex: Conta de Luz" />
          </div>
          <div>
            <label className="text-sm">Categoria *</label>
            <Input value={form.category} onChange={e => setForm({...form, category: e.target.value})} placeholder="Ex: operacional" />
          </div>
          <div>
            <label className="text-sm">Valor *</label>
            <Input type="number" min="0" step="0.01" value={form.amount} onChange={e => setForm({...form, amount: e.target.value})} placeholder="Ex: 150.00" />
          </div>
          <div>
            <label className="text-sm">Vencimento *</label>
            <Input type="date" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} />
          </div>
          <Button onClick={handleSave} isLoading={createMutation.isPending || updateMutation.isPending} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white">
            {editingId ? "Salvar Alterações" : "Salvar Despesa"}
          </Button>
        </div>
      </Modal>
    )}
    </>
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
  const [form, setForm] = useState({
    name: "",
    type: "product",
    description: "",
    price: "",
    stockQuantity: "",
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
    setForm({
      name: item.name,
      type: item.type,
      description: item.description || "",
      price: (item.basePrice / 100).toString(),
      stockQuantity: item.stockQuantity?.toString() || "",
      priceSmall: item.pricingBySize?.small ? (item.pricingBySize.small).toString() : "",
      priceMedium: item.pricingBySize?.medium ? (item.pricingBySize.medium).toString() : "",
      priceLarge: item.pricingBySize?.large ? (item.pricingBySize.large).toString() : "",
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
    const val = parseFloat(form.price);
    if (isNaN(val) || val < 0) {
      toast({ title: "Erro", description: "Preço não pode ser negativo", variant: "destructive" });
      return;
    }
    if (form.type === "package" && (!form.creditsAmount || parseInt(form.creditsAmount) <= 0)) {
      toast({ title: "Erro", description: "Informe a quantidade de diárias (créditos) do pacote", variant: "destructive" });
      return;
    }

    const payload = {
      name: form.name,
      type: form.type,
      description: form.description,
      price: val * 100, // convert to cents
      stockQuantity: form.type === "product" && form.stockQuantity ? parseInt(form.stockQuantity) : null,
      creditsAmount: form.type === "package" && form.creditsAmount ? parseInt(form.creditsAmount) : null,
      maxPetsPerDay: form.type === "package" && form.maxPetsPerDay ? parseInt(form.maxPetsPerDay) : 1,
      pricingBySize: form.type === "service" ? {
        small: form.priceSmall ? parseFloat(form.priceSmall) * 100 : val * 100,
        medium: form.priceMedium ? parseFloat(form.priceMedium) * 100 : val * 100,
        large: form.priceLarge ? parseFloat(form.priceLarge) * 100 : val * 100,
      } : undefined,
      category: form.category || null,
      sku: form.sku || null,
      barcode: form.barcode || null,
      costPrice: form.costPrice && form.type === "product" ? parseFloat(form.costPrice) * 100 : null,
      mediaUrls: form.imageUrl ? [form.imageUrl] : []
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload }, {
        onSuccess: () => {
          setModalOpen(false);
          setEditingId(null);
          setForm({ name: "", type: "product", description: "", price: "", stockQuantity: "", priceSmall: "", priceMedium: "", priceLarge: "", creditsAmount: "", maxPetsPerDay: "1", category: "", sku: "", barcode: "", costPrice: "", imageUrl: "" });
          toast({ title: "Sucesso", description: "Item atualizado no catálogo", variant: "default" });
        },
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => {
          setModalOpen(false);
          setForm({ name: "", type: "product", description: "", price: "", stockQuantity: "", priceSmall: "", priceMedium: "", priceLarge: "", creditsAmount: "", maxPetsPerDay: "1", category: "", sku: "", barcode: "", costPrice: "", imageUrl: "" });
          toast({ title: "Sucesso", description: "Item adicionado ao catálogo", variant: "default" });
        },
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    }
  };


  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando catálogo...</div>;
  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h3 className="font-medium text-white">Catálogo de Produtos e Serviços</h3>
        <Button size="sm" onClick={() => {
          setEditingId(null);
          setForm({ name: "", type: "product", description: "", price: "", stockQuantity: "", priceSmall: "", priceMedium: "", priceLarge: "", creditsAmount: "", maxPetsPerDay: "1", category: "", sku: "", barcode: "", costPrice: "", imageUrl: "" });
          setModalOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" /> Novo Item
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {catalogue?.map((item: any) => (
          <Card key={item.id} className="overflow-hidden group">
            <CardContent className="p-0">
              <div className="h-32 bg-white/5 relative flex items-center justify-center overflow-hidden">
                {item.mediaUrls && item.mediaUrls.length > 0 ? (
                  <img src={item.mediaUrls[0]} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                ) : (
                  <PackageOpen className="h-10 w-10 text-white/20 group-hover:scale-110 transition-transform" />
                )}
                
                {item.type === "product" && item.stockQuantity !== null && item.stockQuantity < 5 && (
                  <div className="absolute top-2 right-2 bg-destructive/80 text-white text-[10px] px-2 py-1 rounded-full font-bold">
                    Estoque Baixo
                  </div>
                )}
              </div>
              <div className="p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <h4 className="font-medium text-white">{item.name}</h4>
                  <Badge variant="outline" className="capitalize text-[10px]">
                    {item.type === 'package' ? 'Pacote' : item.type}
                  </Badge>
                </div>
                {item.type === "service" && (item.pricingBySize?.small || item.pricingBySize?.medium || item.pricingBySize?.large) ? (
                  <p className="text-2xl font-bold text-emerald-400">
                    <span className="text-sm font-normal text-muted-foreground mr-1">A partir de</span>
                    {formatBRL(
                      Math.min(
                        Number(item.price),
                        Number(item.pricingBySize?.small || item.price),
                        Number(item.pricingBySize?.medium || item.price),
                        Number(item.pricingBySize?.large || item.price)
                      )
                    )}
                  </p>
                ) : (
                  <p className="text-2xl font-bold text-emerald-400">{formatBRL(item.price)}</p>
                )}
                {item.type === "product" && (
                  <p className="text-xs text-muted-foreground pt-2">
                    Em estoque: <strong className="text-white">{item.stockQuantity ?? 'Ilimitado'}</strong>
                  </p>
                )}
                {item.type === "package" && item.creditsAmount && (
                  <p className="text-xs text-muted-foreground pt-2">
                    <strong className="text-white">{item.creditsAmount} diárias</strong>
                    {item.maxPetsPerDay && item.maxPetsPerDay > 1 && (
                      <span className="ml-1 text-emerald-400 font-medium">(Até {item.maxPetsPerDay} pets/dia)</span>
                    )}
                  </p>
                )}
                
                <div className="pt-4 flex gap-2">
                  <Button size="sm" variant="default" className="bg-white/10 text-white flex-1" onClick={() => openEditModal(item)}>
                    Editar
                  </Button>

                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => handleDelete(item.id)} isLoading={deleteMutation.isPending}>
                    Excluir
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {modalOpen && (
        <Modal isOpen={true} onClose={() => setModalOpen(false)} title={editingId ? "Editar Item do Catálogo" : "Novo Item no Catálogo"} className="max-w-2xl">
          <div className="space-y-4">
            {editingId && (
              <CatalogueSmartIndicators crecheId={crecheId} itemId={editingId} type={form.type} />
            )}
            <div>
              <label className="text-sm">Nome *</label>
              <Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Nome do item" />
            </div>
            <div>
              <label className="text-sm">Tipo</label>
              <select 
                className="w-full bg-white/5 border border-white/10 rounded-md h-10 px-3 text-sm"
                value={form.type} 
                onChange={e => setForm({...form, type: e.target.value})}
              >
                <option value="product" className="bg-zinc-900">Produto</option>
                <option value="service" className="bg-zinc-900">Serviço</option>
                <option value="package" className="bg-zinc-900">Pacote de Diárias</option>
              </select>
            </div>
            <div>
              <label className="text-sm">Categoria</label>
              <Input value={form.category} onChange={e => setForm({...form, category: e.target.value})} placeholder="Ex: Rações, Brinquedos" />
            </div>
            <div>
              <label className="text-sm">Descrição</label>
              <textarea 
                value={form.description} 
                onChange={e => setForm({...form, description: e.target.value})} 
                className="w-full bg-white/5 border border-white/10 rounded-md p-3 text-sm min-h-[80px]"
                placeholder="Detalhes do item..." 
              />
            </div>
            <div>
              <label className="text-sm">URL da Imagem</label>
              <Input value={form.imageUrl} onChange={e => setForm({...form, imageUrl: e.target.value})} placeholder="https://exemplo.com/foto.jpg" />
            </div>
            <div>
              <label className="text-sm">Preço (R$) *</label>
              <Input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({...form, price: e.target.value})} placeholder="10.00" />
            </div>
            
            {form.type === "product" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm">Preço de Custo (R$)</label>
                    <Input type="number" min="0" step="0.01" value={form.costPrice} onChange={e => setForm({...form, costPrice: e.target.value})} placeholder="Opcional" />
                  </div>
                  <div>
                    <label className="text-sm">Estoque (opcional)</label>
                    <Input type="number" min="0" value={form.stockQuantity} onChange={e => setForm({...form, stockQuantity: e.target.value})} placeholder="Quantidade" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm">Código de Barras</label>
                    <Input value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} placeholder="Ex: 7891000..." autoFocus={modalOpen && form.type === 'product'} />
                  </div>
                  <div>
                    <label className="text-sm">SKU (opcional)</label>
                    <Input value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} placeholder="Código interno" />
                  </div>
                </div>
              </>
            )}

            {form.type === "package" && (
              <div className="space-y-4">
                <div>
                  <label className="text-sm">Quantidade de Diárias (Créditos) *</label>
                  <Input type="number" min="1" value={form.creditsAmount} onChange={e => setForm({...form, creditsAmount: e.target.value})} placeholder="Ex: 20" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Ao comprar este pacote, o tutor receberá exatamente este número de diárias.
                  </p>
                </div>
                <div>
                  <label className="text-sm">Limite de Pets por Diária</label>
                  <Input type="number" min="1" value={form.maxPetsPerDay} onChange={e => setForm({...form, maxPetsPerDay: e.target.value})} placeholder="Ex: 1" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Uma mesma diária cobrirá até esta quantidade de pets simultâneos. Deixe 1 para pacotes normais.
                  </p>
                </div>
              </div>
            )}

            {form.type === "service" && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs">Preço Pequeno (opcional)</label>
                  <Input type="number" min="0" step="0.01" value={form.priceSmall} onChange={e => setForm({...form, priceSmall: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs">Preço Médio (opcional)</label>
                  <Input type="number" min="0" step="0.01" value={form.priceMedium} onChange={e => setForm({...form, priceMedium: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs">Preço Grande (opcional)</label>
                  <Input type="number" min="0" step="0.01" value={form.priceLarge} onChange={e => setForm({...form, priceLarge: e.target.value})} />
                </div>
              </div>
            )}

            <Button onClick={handleSave} isLoading={createMutation.isPending} className="w-full">
              Salvar Item
            </Button>
          </div>
        </Modal>
      )}
    </>
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
      return new Date(inv.dueDate).getTime() < new Date().setHours(0,0,0,0);
    }
    return false;
  });

  const columns = React.useMemo(() => [
    { accessorKey: "tutorName", header: "Tutor", cell: (info: any) => <span className="font-medium text-white">{info.getValue() || "Desconhecido"}</span> },
    { accessorKey: "dueDate", header: "Vencimento", cell: (info: any) => info.getValue() ? format(new Date(info.getValue()), "dd/MM/yyyy", { locale: ptBR }) : "—" },
    { accessorKey: "amount", header: "Valor", cell: (info: any) => <span className="font-medium text-white">{formatBRL(info.getValue())}</span> },
    { 
      id: "daysLate", 
      header: "Dias Atraso", 
      cell: ({ row }: any) => {
         const inv = row.original;
         const daysLate = inv.dueDate ? Math.floor((new Date().getTime() - new Date(inv.dueDate).getTime()) / (1000 * 3600 * 24)) : 0;
         return <span className="text-destructive font-bold">{daysLate} dias</span>;
      }
    },
    {
      id: "actions",
      header: () => <div className="text-right">Ações</div>,
      cell: ({ row }: any) => {
        const inv = row.original;
        const msg = encodeURIComponent(`Olá ${inv.tutorName || "Tutor"}, notamos que há uma fatura em aberto no valor de ${formatBRL(inv.amount)}. Poderia verificar?`);
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
            {formatBRL(totalDefaulters)}
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

  const handleApproveReceipt = (id: number) => {
    approveReceiptMutation.mutate(id, {
      onSuccess: () => toast({ title: "Sucesso", description: "Comprovante aprovado e fatura liquidada." }),
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  const pendingReceipts = invoicesData?.data?.filter((i: any) => i.status === 'awaiting_confirmation') || [];


  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando comprovantes...</div>;
  return (
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
                  <p className="font-bold text-white">{formatBRL(inv.amount)}</p>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">Vencimento:</span>
                  <span className="text-white">{inv.dueDate ? format(new Date(inv.dueDate), "dd/MM/yyyy", { locale: ptBR }) : "—"}</span>
                </div>
                <div className="flex gap-2 pt-2 border-t border-white/5">
                  {inv.receiptPhotoPath && (
                    <Button variant="ghost" size="sm" onClick={() => {
                      window.open(`/api/files/download/${inv.receiptPhotoPath}?t=${Date.now()}`, '_blank');
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
                      {inv.dueDate ? format(new Date(inv.dueDate), "dd/MM/yyyy", { locale: ptBR }) : "—"}
                    </td>
                    <td className="px-6 py-4 text-white font-medium">{formatBRL(inv.amount)}</td>
                    <td className="px-6 py-4 text-right space-x-2">
                      {inv.receiptPhotoPath && (
                        <Button variant="ghost" size="sm" onClick={() => {
                          window.open(`/api/files/download/${inv.receiptPhotoPath}?t=${Date.now()}`, '_blank');
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
  );
}

function AuditTab({ crecheId }: { crecheId: number }) {
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

function OrdersTab({ crecheId }: { crecheId: number }) {
  const { data: orders, isLoading } = useListOrders(crecheId);
  const updateStatus = useUpdateOrderStatus(crecheId);
  const approveReceipt = useApproveReceipt(crecheId);
  const { toast } = useToast();
  
  const [confirmModal, setConfirmModal] = React.useState<{isOpen: boolean, orderId: number, nextStatus: string, order: any} | null>(null);


  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'pending_payment': return <Badge variant="outline" className="text-yellow-400 border-yellow-400">Pendente</Badge>;
      case 'paid': return <Badge variant="outline" className="text-emerald-400 border-emerald-400">Pago</Badge>;
      case 'preparing': return <Badge variant="outline" className="text-blue-400 border-blue-400">Separando</Badge>;
      case 'ready_for_pickup': return <Badge variant="outline" className="text-purple-400 border-purple-400">Pronto p/ Retirada</Badge>;
      case 'delivering': return <Badge variant="outline" className="text-indigo-400 border-indigo-400">Em Rota</Badge>;
      case 'delivered': return <Badge variant="outline" className="text-zinc-400 border-zinc-400">Entregue</Badge>;
      case 'cancelled': return <Badge variant="outline" className="text-red-400 border-red-400">Cancelado</Badge>;
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
        <h3 className="font-medium text-white">Pedidos da Loja</h3>
      </div>
      
      <div className="grid grid-cols-1 gap-4">
        {orders?.length === 0 && <p className="text-muted-foreground">Nenhum pedido encontrado.</p>}
        {orders?.map((order: any) => (
          <Card key={order.id} className="bg-white/5 border-white/10">
            <CardContent className="p-4 flex flex-col md:flex-row justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-white text-lg">Pedido #{order.id}</h4>
                  {getStatusBadge(order.status)}
                  <Badge variant="secondary">{order.deliveryMethod === 'delivery' ? 'Entrega' : 'Retirada'}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">Tutor: <span className="text-white">{order.tutor?.name}</span> {order.tutor?.phone && `(${order.tutor?.phone})`}</p>
                {order.deliveryMethod === 'delivery' && (
                  <p className="text-sm text-muted-foreground">Endereço: <span className="text-white">{order.deliveryAddress}</span></p>
                )}
                <div className="pt-2 space-y-1">
                  {order.items?.map((item: any, idx: number) => (
                    <p key={idx} className="text-sm text-muted-foreground">
                      {item.quantity}x <span className="text-white">{item.name}</span> - {formatBRL(item.totalPrice)}
                    </p>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end justify-between space-y-4">
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Frete: {formatBRL(order.deliveryFee)}</p>
                  <p className="text-xl font-bold text-emerald-400">Total: {formatBRL(order.total)}</p>
                </div>
                
                <div className="flex gap-2 flex-wrap justify-end">
                  {order.status === 'pending_payment' && (
                    <>
                      <Button size="sm" variant="outline" className="border-emerald-500 text-emerald-500 hover:bg-emerald-500 hover:text-white" onClick={() => handleUpdateStatus(order.id, 'paid', order)}>Confirmar Pagamento</Button>
                      <Button size="sm" variant="destructive" onClick={() => handleUpdateStatus(order.id, 'cancelled', order)}>Cancelar</Button>
                    </>
                  )}
                  {order.status === 'paid' && (
                    <Button size="sm" onClick={() => handleUpdateStatus(order.id, 'preparing', order)}>Iniciar Separação</Button>
                  )}
                  {order.status === 'preparing' && (
                    <Button size="sm" onClick={() => handleUpdateStatus(order.id, order.deliveryMethod === 'delivery' ? 'delivering' : 'ready_for_pickup', order)}>
                      {order.deliveryMethod === 'delivery' ? 'Saiu p/ Entrega' : 'Pronto p/ Retirada'}
                    </Button>
                  )}
                  {(order.status === 'delivering' || order.status === 'ready_for_pickup') && (
                    <Button size="sm" variant="default" className="bg-emerald-500 hover:bg-emerald-600" onClick={() => handleUpdateStatus(order.id, 'delivered', order)}>Marcar Entregue</Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Modal isOpen={confirmModal?.isOpen || false} onClose={() => setConfirmModal(null)} title="Fatura em Aberto ⚠️" description={`Este pedido possui uma fatura pendente no valor de ${formatBRL(confirmModal?.order?.invoiceAmount || 0)}. O tutor já realizou o pagamento no balcão/Pix?`}>
          <div className="flex flex-col gap-3 mt-4">
            <Button onClick={handleConfirmWithPayment} className="bg-emerald-500 hover:bg-emerald-600 text-white w-full justify-start">
              <CheckCircle className="mr-2 h-4 w-4" /> Sim, confirmar pagamento e dar baixa na fatura
            </Button>
            <Button variant="outline" onClick={handleConfirmWithoutPayment} className="border-white/10 hover:bg-white/5 w-full justify-start">
              <Clock className="mr-2 h-4 w-4 text-yellow-500" /> Não, vai pagar depois (manter fatura aberta)
            </Button>
            <Button variant="ghost" onClick={() => setConfirmModal(null)} className="w-full">
              Cancelar alteração
            </Button>
          </div>
      </Modal>
    </div>
  );
}

function FinancialDashboardContent() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
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
      id: "visao",
      label: "Visão Geral",
      items: [
        { id: "reports", label: "Central de Relatórios", icon: <FileText className="h-4 w-4" />, content: <ReportsCentralTab crecheId={crecheId} /> }
      ]
    },
    {
      id: "operacional",
      label: "Operacional",
      items: [
        { id: "cashflow", label: "Movimentações", icon: <BarChart3 className="h-4 w-4" />, content: <CashFlowTab crecheId={crecheId} /> },
        { id: "receivables", label: "A Receber", icon: <Receipt className="h-4 w-4" />, content: <ReceivablesTab crecheId={crecheId} /> },
        { id: "defaulters", label: "Inadimplência", icon: <FileText className="h-4 w-4 text-red-400" />, content: <DefaultersTab crecheId={crecheId} /> },
        { id: "payables", label: "A Pagar", icon: <FileText className="h-4 w-4" />, content: <PayablesTab crecheId={crecheId} /> }
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

export default function FinancialDashboard() {
  return (
    <FinancialProvider>
      <FinancialDashboardContent />
    </FinancialProvider>
  );
}
