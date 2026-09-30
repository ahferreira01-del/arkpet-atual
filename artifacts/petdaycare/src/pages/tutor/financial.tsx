import React, { useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGetCreche, getGetCrecheQueryKey } from "@workspace/api-client-react";
import { useTutorInvoices, useStripeCheckout, usePackagesBalance, useListOrders, useServiceCredits } from "@/hooks/use-financial";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { uploadFileDirect } from "@/lib/utils";
import { useLocation } from "wouter";
import { Receipt, UploadCloud, CheckCircle2, History, ExternalLink, Eye, Package, ShoppingCart, QrCode, Copy, Check, Scissors, CalendarCheck, Printer } from "lucide-react";
import { ThermalReceiptModal } from "@/components/modals/ThermalReceiptModal";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { parseLocalDate } from "@/lib/date-utils";
import { useInvoiceItems } from "@/hooks/use-financial";
import QRCode from "qrcode";
import { generatePixPayload } from "@/lib/pix";
import { formatCentsToBRL } from "@/lib/money";

export default function TutorFinancial() {
  const { user } = useAuth();
  const crecheId = user?.crecheId as number;
  const tutorId = user?.id;
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: invoices, isLoading, refetch } = useTutorInvoices(crecheId, tutorId);
  const { data: orders, isLoading: isLoadingOrders } = useListOrders(crecheId);
  const stripeMutation = useStripeCheckout(crecheId);
  
  const [activeTab, setActiveTab] = useState("overview");
  const [uploadingFor, setUploadingFor] = useState<number | null>(null);
  const [detailsFor, setDetailsFor] = useState<number | null>(null);
  const [receiptModalId, setReceiptModalId] = useState<number | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [pixInvoice, setPixInvoice] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);

  const handlePixUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingFor) return;
    if (fileInputRef.current) fileInputRef.current.value = "";

    const token = localStorage.getItem("auth_token");
    setUploading(true);
    toast({ title: "Enviando comprovante...", description: "Aguarde um momento." });

    try {
      const objectPath = await uploadFileDirect(file, token!);

      const receiptRes = await fetch(`/api/creches/${crecheId}/financial/invoices/${uploadingFor}/upload-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ receiptPhotoPath: objectPath }),
      });
      if (!receiptRes.ok) {
        const err = await receiptRes.json().catch(() => ({}));
        throw new Error(err.error || "Erro ao registrar comprovante.");
      }

      toast({
        title: "Comprovante enviado!",
        description: "A creche irá avaliar seu comprovante em breve.",
      });
      refetch();
    } catch (err: any) {
      toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadingFor(null);
    }
  };

  const handleViewReceipt = async (invoiceId: number) => {
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/receipt-url`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Comprovante não encontrado");
      const data = await res.json();
      if (data.url) setReceiptPreviewUrl(data.url);
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const { data: packagesData, isLoading: isLoadingPackages } = usePackagesBalance(crecheId);
  const { data: serviceCreditsData, isLoading: isLoadingServiceCredits } = useServiceCredits(crecheId);
  const availableCredits = packagesData?.availableCredits || 0;

  if (isLoading || isLoadingPackages || isLoadingOrders || isLoadingServiceCredits) return <div className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center min-h-[60vh]">Carregando carteira...</div>;

  const invoiceList = invoices?.data || (Array.isArray(invoices) ? invoices : []);
  const openInvoices = invoiceList.filter((inv: any) => inv.status !== "paid");
  const paidInvoices = invoiceList.filter((inv: any) => inv.status === "paid");

  // ArkListTile para Faturas
  const renderInvoiceList = (list: any[], isHistory = false) => {
    if (list.length === 0) {
      return (
        <div className="p-12 rounded-3xl border border-border bg-card text-center flex flex-col items-center justify-center space-y-4">
          <CheckCircle2 className="h-16 w-16 text-success opacity-20" />
          <div>
            <p className="text-foreground font-medium text-lg">{isHistory ? "Nenhum histórico" : "Tudo em dia!"}</p>
            <p className="text-sm text-muted-foreground">{isHistory ? "Nenhum pagamento registrado no seu histórico." : "Você não possui faturas pendentes no momento."}</p>
          </div>
        </div>
      );
    }

    return list.map((inv: any) => {
      const isPaid = inv.status === "paid";
      const isOverdue = inv.status === "overdue";
      const isAwaiting = inv.status === "awaiting_confirmation";
      const dateLabel = isPaid && inv.updatedAt ? `Pago em ${format(new Date(inv.updatedAt + "Z"), "dd/MM", { locale: ptBR })}` : `Venc: ${format(parseLocalDate(inv.dueDate), "dd/MM", { locale: ptBR })}`;
      
      return (
        <div key={inv.id} className="group relative flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 mb-3 rounded-2xl border border-border bg-card hover:bg-secondary/20 transition-all shadow-sm">
          <div className="flex items-start gap-4">
            <div className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 ${isPaid ? 'bg-success/10 text-success' : isOverdue ? 'bg-destructive/10 text-destructive' : isAwaiting ? 'bg-warning/10 text-warning' : 'bg-primary/10 text-primary'}`}>
              <Receipt className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h4 className="font-semibold text-foreground text-base">Fatura #{inv.id}</h4>
                {isOverdue && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-destructive/10 text-destructive">Vencida</span>}
                {isAwaiting && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-warning/10 text-warning">Em Análise</span>}
                {isPaid && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-success/10 text-success">Paga</span>}
              </div>
              <p className="text-sm text-muted-foreground font-medium">
                {dateLabel}
              </p>
            </div>
          </div>
          
          <div className="flex flex-col sm:items-end justify-center w-full sm:w-auto mt-4 sm:mt-0 pt-4 sm:pt-0 border-t border-border sm:border-0">
            <p className="text-xl font-bold text-foreground mb-2.5 sm:mb-2">{formatCentsToBRL(inv.amount ? Number(inv.amount) : inv.totalAmount)}</p>
            
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto">
              <Button variant="outline" size="sm" className="h-11 sm:h-9 text-xs sm:text-sm text-muted-foreground hover:text-foreground flex-1 sm:flex-none border-border bg-card hover:bg-secondary" onClick={() => setDetailsFor(inv.id)}>
                <Eye className="mr-1.5 h-4 w-4 sm:h-3.5 sm:w-3.5" /> Detalhes
              </Button>
              {isPaid && inv.receiptPhotoPath && (
                <Button variant="outline" size="sm" onClick={() => handleViewReceipt(inv.id)} className="h-11 sm:h-9 text-xs sm:text-sm text-muted-foreground hover:text-foreground flex-1 sm:flex-none border-border bg-card hover:bg-secondary">
                  <ExternalLink className="mr-1.5 h-4 w-4 sm:h-3.5 sm:w-3.5" /> Comprovante
                </Button>
              )}
              {isPaid && (
                <Button variant="outline" size="sm" onClick={() => setReceiptModalId(inv.id)} className="h-11 sm:h-9 text-xs sm:text-sm text-success hover:text-success border-success/30 hover:border-success/50 hover:bg-success/5 flex-1 sm:flex-none w-full sm:w-auto mt-2 sm:mt-0">
                  <Printer className="mr-1.5 h-4 w-4 sm:h-3.5 sm:w-3.5" /> Recibo NFC-e
                </Button>
              )}
              {!isPaid && !isAwaiting && (
                <Button 
                  size="sm"
                  onClick={() => setPixInvoice(inv)}
                  className="h-11 sm:h-9 bg-primary hover:bg-primary/90 text-primary-foreground flex-1 sm:flex-none shadow-sm text-xs sm:text-sm w-full sm:w-auto mt-2 sm:mt-0"
                >
                  <QrCode className="mr-1.5 h-4 w-4 sm:h-3.5 sm:w-3.5" /> Pagar Fatura
                </Button>
              )}
            </div>
          </div>
        </div>
      );
    });
  };

  const getOrderStatusInfo = (status: string) => {
    switch(status) {
      case 'pending_payment': return { label: 'Aguardando Pagamento', color: 'text-warning bg-warning/10 border border-warning/20' };
      case 'paid': return { label: 'Pagamento Aprovado', color: 'text-success bg-success/10 border border-success/20' };
      case 'preparing': return { label: 'Em Preparação', color: 'text-primary bg-primary/10 border border-primary/20' };
      case 'ready_for_pickup': return { label: 'Pronto para Retirada', color: 'text-primary bg-primary/10 border border-primary/20' };
      case 'delivering': return { label: 'Saiu para Entrega', color: 'text-primary bg-primary/10 border border-primary/20' };
      case 'delivered': return { label: 'Concluído', color: 'text-success bg-success/10 border border-success/20' };
      case 'cancelled': return { label: 'Cancelado', color: 'text-destructive bg-destructive/10 border border-destructive/20' };
      default: return { label: status, color: 'text-muted-foreground bg-secondary border border-border' };
    }
  };

  // ArkListTile para Timeline de Pedidos
  const renderOrdersList = (list: any[]) => {
    if (list.length === 0) {
      return (
        <div className="p-12 rounded-3xl border border-border bg-card text-center flex flex-col items-center justify-center space-y-4">
          <Package className="h-16 w-16 text-muted-foreground opacity-20" />
          <div>
            <p className="text-foreground font-medium text-lg">Nenhum pedido ainda!</p>
            <p className="text-sm text-muted-foreground">Que tal visitar nossa Lojinha e fazer sua primeira compra?</p>
          </div>
        </div>
      );
    }

    return list.map((order: any) => {
      const statusInfo = getOrderStatusInfo(order.status);
      
      return (
        <div key={order.id} className="group relative flex flex-col p-4 sm:p-5 mb-3 rounded-2xl border border-border bg-card hover:bg-secondary/20 transition-all shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="flex items-start gap-4">
               <div className="h-12 w-12 rounded-full flex items-center justify-center shrink-0 bg-secondary border border-border">
                 <Package className="h-5 w-5 text-muted-foreground" />
               </div>
               <div>
                  <h4 className="font-semibold text-foreground text-base">Pedido #{order.id}</h4>
                  <p className="text-sm text-muted-foreground font-medium">{format(new Date(order.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
               </div>
            </div>
            <div className="flex items-center justify-between sm:flex-col sm:items-end w-full sm:w-auto mt-2 sm:mt-0 pt-2 sm:pt-0 border-t border-border sm:border-t-0">
               <p className="text-lg font-bold text-foreground sm:mb-1.5">{formatCentsToBRL(Number(order.total))}</p>
               <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusInfo.color}`}>{statusInfo.label}</span>
            </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-border sm:pl-[64px]">
            <div className="space-y-2">
              {order.items?.map((item: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center text-sm">
                  <span className="text-foreground/80 font-medium"><span className="text-muted-foreground mr-1.5 font-bold">{item.quantity}x</span> {item.name}</span>
                  <span className="text-muted-foreground font-medium">{formatCentsToBRL(Number(item.unitPrice))}</span>
                </div>
              ))}
            </div>
            {order.status === 'pending_payment' && order.invoiceId && (
               <Button 
                 variant="outline" 
                 size="sm"
                 className="mt-4 w-full sm:w-auto text-warning hover:text-warning border-warning/30 bg-warning/5 hover:bg-warning/10 min-h-11 sm:min-h-9"
                 onClick={() => {
                   const invoice = (invoices?.data || invoices)?.find((i:any) => i.id === order.invoiceId);
                   if (invoice) {
                     const tabsEl = document.querySelector('[role="tablist"] [value="invoices"]') as HTMLElement;
                     if (tabsEl) tabsEl.click();
                     setPixInvoice(invoice);
                   }
                 }}
               >
                 <QrCode className="mr-2 h-4 w-4" /> Anexar Comprovante do Pedido
               </Button>
            )}
          </div>
        </div>
      );
    });
  };

  const tabsConfig = [
    {
      id: "overview",
      label: "Visão Geral",
      content: (
        <div className="space-y-8 focus-visible:outline-none focus-visible:ring-0 pt-2">
          
          {/* ArkSummaryCard */}
          <div className="relative rounded-3xl overflow-hidden bg-primary/10 border border-primary/20 p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row justify-between sm:items-end mb-6 sm:mb-8 gap-4">
              <div>
                <p className="text-muted-foreground text-sm uppercase tracking-widest font-semibold mb-1">Meus Benefícios</p>
                <h2 className="text-2xl sm:text-3xl font-display font-bold text-foreground">Créditos Disponíveis</h2>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="bg-card rounded-2xl p-5 sm:p-6 border border-border flex flex-col justify-between shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-semibold text-primary uppercase tracking-wider flex items-center gap-2"><CalendarCheck className="h-4 w-4"/> Pacotes de Diárias</p>
                    <Button onClick={() => navigate('/tutor/store')} variant="outline" size="sm" className="h-9 border-border text-foreground hover:bg-secondary">
                       Lojinha
                    </Button>
                  </div>
                  <div className="flex items-baseline gap-2">
                     <p className="text-5xl sm:text-6xl font-display font-bold text-foreground tracking-tight">{availableCredits}</p>
                     <p className="text-muted-foreground font-medium text-lg">diárias</p>
                  </div>
               </div>
               
               {serviceCreditsData?.data && serviceCreditsData.data.length > 0 ? (
                 <div className="bg-card rounded-2xl p-5 sm:p-6 border border-border flex flex-col justify-start shadow-sm">
                     <p className="text-sm font-semibold text-primary uppercase tracking-wider flex items-center gap-2 mb-4"><Scissors className="h-4 w-4"/> Serviços Pré-pagos</p>
                     <div className="space-y-3">
                       {serviceCreditsData.data.map((credit: any) => {
                         const remaining = credit.totalCredits - credit.usedCredits;
                         return (
                            <div key={credit.id} className="flex justify-between items-center bg-secondary/50 p-3 rounded-xl border border-border">
                               <span className="text-foreground font-medium text-sm flex items-center gap-2">
                                 <span className="w-2 h-2 rounded-full bg-primary"></span>
                                 {credit.itemName}
                               </span>
                               <span className="bg-primary/10 border border-primary/20 text-primary px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider">{remaining} disp.</span>
                            </div>
                         )
                       })}
                     </div>
                 </div>
               ) : (
                 <div className="bg-secondary/30 rounded-2xl p-5 sm:p-6 border border-border border-dashed flex flex-col justify-center items-center text-center min-h-[160px]">
                    <Scissors className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                    <p className="text-sm font-medium text-foreground mb-1">Sem serviços avulsos</p>
                    <p className="text-xs text-muted-foreground">Compre banhos e extras antecipados na lojinha para economizar.</p>
                 </div>
               )}
            </div>
          </div>
          
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground">
                <Receipt className="h-5 w-5 text-warning" /> Próximos Pagamentos
              </h3>
            </div>
            {renderInvoiceList(openInvoices.slice(0, 3))}
            {openInvoices.length > 3 && (
              <Button
                variant="outline"
                className="w-full mt-2 h-12 text-muted-foreground hover:text-foreground bg-card border-border hover:bg-secondary"
                onClick={() => {
                  setActiveTab("invoices");
                  // Bring the tab content into view — on mobile the button sits
                  // far down the page and the tab switch alone isn't noticeable.
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                Ver todas as {openInvoices.length} faturas pendentes
              </Button>
            )}
          </div>
        </div>
      )
    },
    {
      id: "invoices",
      label: "Faturas",
      content: (
        <div className="space-y-4 focus-visible:outline-none focus-visible:ring-0 pt-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Abertas e Pendentes</h3>
            <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-warning/10 text-warning border border-warning/20">{openInvoices.length} {openInvoices.length === 1 ? 'pendente' : 'pendentes'}</span>
          </div>
          {renderInvoiceList(openInvoices)}
        </div>
      )
    },
    {
      id: "history",
      label: "Histórico",
      content: (
        <div className="space-y-4 focus-visible:outline-none focus-visible:ring-0 pt-2">
          <h3 className="text-lg font-semibold flex items-center gap-2 text-foreground mb-4">
            <History className="h-5 w-5 text-primary" /> Histórico Financeiro
          </h3>
          {renderInvoiceList(paidInvoices, true)}
        </div>
      )
    },
    {
      id: "orders",
      label: "Meus Pedidos",
      content: (
        <div className="space-y-4 focus-visible:outline-none focus-visible:ring-0 pt-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Acompanhamento da Lojinha</h3>
          </div>
          {renderOrdersList(orders || [])}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Minha Carteira</h1>
          <p className="text-muted-foreground mt-1 text-sm">Gerencie faturas, créditos e pacotes da creche.</p>
        </div>
      </div>

      <Tabs defaultTab="overview" value={activeTab} onValueChange={setActiveTab} tabs={tabsConfig} />

      <input
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        ref={fileInputRef}
        onChange={handlePixUpload}
      />
      
      {detailsFor && (
        <InvoiceDetailsModal 
          isOpen={true} 
          onClose={() => setDetailsFor(null)} 
          invoiceId={detailsFor} 
          crecheId={crecheId} 
        />
      )}

      {receiptModalId && (
        <ThermalReceiptModal invoiceId={receiptModalId} onClose={() => setReceiptModalId(null)} />
      )}

      {pixInvoice && (
        <PixPaymentModal 
          isOpen={true}
          onClose={() => setPixInvoice(null)}
          invoice={pixInvoice}
          onUploadClick={() => {
            setPixInvoice(null);
            setUploadingFor(pixInvoice.id);
            setTimeout(() => fileInputRef.current?.click(), 150);
          }}
        />
      )}

      {receiptPreviewUrl && (
        <Modal isOpen onClose={() => setReceiptPreviewUrl(null)} title="Comprovante de Pagamento">
          <div className="flex justify-center p-2 bg-secondary/20 rounded-xl mt-2 border border-border">
            <img
              src={receiptPreviewUrl}
              alt="Comprovante"
              className="max-w-full max-h-[70vh] rounded-lg object-contain shadow-sm"
            />
          </div>
          <div className="pt-6 flex justify-end">
            <Button variant="outline" className="w-full sm:w-auto h-11" onClick={() => setReceiptPreviewUrl(null)}>Fechar</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function InvoiceDetailsModal({ isOpen, onClose, invoiceId, crecheId }: { isOpen: boolean, onClose: () => void, invoiceId: number, crecheId: number }) {
  const { data: items, isLoading } = useInvoiceItems(crecheId, invoiceId);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Recibo da Fatura #${invoiceId}`}>
      <div className="space-y-4 mt-2">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center bg-card rounded-xl border border-border">Carregando detalhes...</div>
        ) : !items || items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground bg-card rounded-xl border border-border">Nenhum item encontrado nesta fatura.</div>
        ) : (
          <div className="space-y-2 bg-card p-4 rounded-xl border border-border shadow-sm">
            {items.map((item: any) => (
              <div key={item.id} className="flex justify-between items-center py-3 border-b border-border last:border-0">
                <div className="flex flex-col pr-4">
                  <p className="text-sm font-semibold text-foreground">{item.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">Qtd: {item.quantity}</p>
                  {item.campaignSnapshot?.campaignName && (
                    <p className="text-xs text-success font-medium mt-0.5">
                      Campanha: {item.campaignSnapshot.campaignName}
                      {Number(item.campaignSnapshot.unitDiscountCents) > 0 && ` (-${formatCentsToBRL(Number(item.campaignSnapshot.unitDiscountCents))})`}
                    </p>
                  )}
                  {!item.campaignSnapshot && item.pricingSourceType === "TUTOR_CONDITION" && (
                    <p className="text-xs text-primary font-medium mt-0.5">Preço especial</p>
                  )}
                </div>
                <span className="font-bold text-foreground">{formatCentsToBRL(Number(item.amount))}</span>
              </div>
            ))}
          </div>
        )}
        <div className="pt-4 flex justify-end">
          <Button onClick={onClose} variant="outline" className="w-full sm:w-auto h-11">Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

function PixPaymentModal({ isOpen, onClose, invoice, onUploadClick }: { isOpen: boolean, onClose: () => void, invoice: any, onUploadClick: () => void }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const { user } = useAuth();
  const { data: creche } = useGetCreche(user?.crecheId as number, {
    query: { 
      queryKey: getGetCrecheQueryKey(user?.crecheId as number),
      enabled: !!user?.crecheId 
    }
  });

  const pixKey = (creche as any)?.pixKey as string | null | undefined;
  const pixName = ((creche as any)?.pixName as string | null | undefined) || "ArkPet";
  const amount = invoice?.amount ? Number(invoice.amount) / 100 : (invoice?.totalAmount ? Number(invoice.totalAmount) / 100 : 0);
  const pixConfigured = !!pixKey;

  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [pixPayload, setPixPayload] = useState<string>("");

  React.useEffect(() => {
    if (isOpen && pixKey && amount > 0) {
      const payload = generatePixPayload(pixKey, pixName, "BRASIL", amount, `FAT${invoice?.id || '00'}`);
      setPixPayload(payload);
      QRCode.toDataURL(payload, { width: 256, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
        .then((url: string) => setQrCodeUrl(url))
        .catch((err: any) => {
          console.error(err);
          toast({
            title: "Erro ao gerar QR Code",
            description: "Não foi possível gerar o código QR do Pix.",
            variant: "destructive",
          });
        });
    } else {
      setQrCodeUrl(null);
      setPixPayload("");
    }
  }, [isOpen, pixKey, pixName, amount, invoice?.id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(pixPayload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Código Copiado!", description: "Cole no aplicativo do seu banco para pagar." });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Pagamento via Pix`}>
      <div className="space-y-6 text-center pt-4">
        
        {!pixConfigured ? (
          <div className="bg-warning/10 border border-warning/20 rounded-2xl p-6 text-center">
            <QrCode className="h-12 w-12 text-warning mx-auto mb-3 opacity-80" />
            <p className="text-warning font-bold text-sm">Chave Pix não configurada</p>
            <p className="text-muted-foreground text-xs mt-2 leading-relaxed">A creche ainda não cadastrou a chave Pix. Entre em contato para combinar o pagamento.</p>
          </div>
        ) : (
          <>
            <div className="bg-card p-4 rounded-3xl inline-block mx-auto border-4 border-success/20 shadow-md">
              {qrCodeUrl ? (
                <img src={qrCodeUrl} alt="QR Code Pix" className="h-44 w-44 object-contain rounded-xl" />
              ) : (
                <QrCode className="h-44 w-44 text-muted-foreground opacity-20" />
              )}
            </div>

            <div>
              <p className="text-4xl font-display font-bold text-foreground tracking-tight">{formatCentsToBRL(invoice?.amount ? Number(invoice.amount) : invoice?.totalAmount || 0)}</p>
              <p className="text-sm font-bold text-success mt-2 uppercase tracking-wider">{pixName}</p>
              <p className="text-sm text-muted-foreground mt-3 px-2 sm:px-6 leading-relaxed">Abra o app do seu banco e escaneie o código QR acima ou utilize o código Copia e Cola abaixo.</p>
            </div>

            <div className="bg-secondary/50 p-2 pl-4 rounded-2xl border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
              <span className="text-foreground font-mono text-xs truncate w-full text-left font-medium opacity-80 pb-2 border-b border-border sm:border-0 sm:pb-0">{pixPayload}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className={`w-full sm:w-auto shrink-0 rounded-xl min-h-[44px] transition-all duration-150 active:scale-95 ${
                  copied
                    ? "bg-success/10 text-success border-success/40 hover:bg-success/15"
                    : "bg-card hover:bg-secondary text-foreground border-border"
                }`}
              >
                {copied ? (
                  <><Check className="h-4 w-4 mr-2" /> Copiado!</>
                ) : (
                  <><Copy className="h-4 w-4 mr-2" /> Copiar Código</>
                )}
              </Button>
            </div>
          </>
        )}

        <div className="pt-4 flex flex-col gap-3">
          <Button onClick={onUploadClick} className="w-full min-h-[56px] h-14 bg-success hover:bg-success/90 text-success-foreground rounded-2xl text-base shadow-sm font-semibold">
            <UploadCloud className="mr-2 h-5 w-5" /> Já paguei, enviar comprovante
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full text-muted-foreground hover:text-foreground rounded-2xl min-h-[48px] h-12">
            Pagar mais tarde
          </Button>
        </div>
      </div>
    </Modal>
  );
}
