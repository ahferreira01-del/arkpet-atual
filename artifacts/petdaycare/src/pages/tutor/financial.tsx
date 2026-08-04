import React, { useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGetCreche } from "@workspace/api-client-react";
import { useTutorInvoices, useStripeCheckout, usePackagesBalance, useListOrders, useServiceCredits } from "@/hooks/use-financial";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { uploadFileDirect } from "@/lib/utils";
import { useLocation } from "wouter";
import { Receipt, UploadCloud, CheckCircle2, History, ExternalLink, Eye, Package, ShoppingCart, QrCode, Copy, Scissors, CalendarCheck, Printer } from "lucide-react";
import { ThermalReceiptModal } from "@/components/modals/ThermalReceiptModal";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useInvoiceItems } from "@/hooks/use-financial";
import QRCode from "qrcode";
import { generatePixPayload } from "@/lib/pix";

function formatBRL(value: number) {
  return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function TutorFinancial() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const tutorId = user?.id;
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: invoices, isLoading, refetch } = useTutorInvoices(crecheId, tutorId);
  const { data: orders, isLoading: isLoadingOrders } = useListOrders(crecheId);
  const stripeMutation = useStripeCheckout(crecheId);
  
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
        <div className="p-12 rounded-3xl border border-white/5 bg-white/5 text-center flex flex-col items-center justify-center space-y-4">
          <CheckCircle2 className="h-16 w-16 text-emerald-400 opacity-20" />
          <div>
            <p className="text-white font-medium text-lg">{isHistory ? "Nenhum histórico" : "Tudo em dia!"}</p>
            <p className="text-sm text-muted-foreground">{isHistory ? "Nenhum pagamento registrado no seu histórico." : "Você não possui faturas pendentes no momento."}</p>
          </div>
        </div>
      );
    }

    return list.map((inv: any) => {
      const isPaid = inv.status === "paid";
      const isOverdue = inv.status === "overdue";
      const isAwaiting = inv.status === "awaiting_confirmation";
      const dateLabel = isPaid && inv.updatedAt ? `Pago em ${format(new Date(inv.updatedAt), "dd/MM", { locale: ptBR })}` : `Venc: ${format(new Date(inv.dueDate), "dd/MM", { locale: ptBR })}`;
      
      return (
        <div key={inv.id} className="group relative flex flex-col sm:flex-row sm:items-center justify-between p-4 mb-3 rounded-2xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.06] transition-all">
          <div className="flex items-start gap-4">
            <div className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 ${isPaid ? 'bg-emerald-500/10 text-emerald-400' : isOverdue ? 'bg-red-500/10 text-red-400' : isAwaiting ? 'bg-amber-500/10 text-amber-400' : 'bg-primary/10 text-primary'}`}>
              <Receipt className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-semibold text-white text-base">Fatura #{inv.id}</h4>
                {isOverdue && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-400">Vencida</span>}
                {isAwaiting && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400">Em Análise</span>}
                {isPaid && <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400">Paga</span>}
              </div>
              <p className="text-sm text-muted-foreground font-medium">
                {dateLabel}
              </p>
            </div>
          </div>
          
          <div className="flex flex-col sm:items-end justify-center w-full sm:w-auto mt-4 sm:mt-0 pt-4 sm:pt-0 border-t border-white/5 sm:border-0">
            <p className="text-xl font-bold text-white mb-2">{formatBRL(inv.amount ? Number(inv.amount) : inv.totalAmount)}</p>
            
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-white flex-1 sm:flex-none bg-white/5 hover:bg-white/10" onClick={() => setDetailsFor(inv.id)}>
                <Eye className="mr-1.5 h-3.5 w-3.5" /> Detalhes
              </Button>
              {isPaid && inv.receiptPhotoPath && (
                <Button variant="ghost" size="sm" onClick={() => handleViewReceipt(inv.id)} className="h-8 text-xs text-muted-foreground hover:text-white flex-1 sm:flex-none bg-white/5 hover:bg-white/10">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Comprovante
                </Button>
              )}
              {isPaid && (
                <Button variant="ghost" size="sm" onClick={() => setReceiptModalId(inv.id)} className="h-8 text-xs text-emerald-400 hover:text-emerald-300 flex-1 sm:flex-none bg-emerald-500/10 hover:bg-emerald-500/20">
                  <Printer className="mr-1.5 h-3.5 w-3.5" /> Recibo NFC-e
                </Button>
              )}
              {!isPaid && !isAwaiting && (
                <Button 
                  size="sm"
                  onClick={() => setPixInvoice(inv)}
                  className="h-8 bg-emerald-500 hover:bg-emerald-600 text-white flex-1 sm:flex-none shadow-lg shadow-emerald-500/20"
                >
                  <QrCode className="mr-1.5 h-3.5 w-3.5" /> Pagar Fatura
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
      case 'pending_payment': return { label: 'Aguardando Pagamento', color: 'text-amber-400 bg-amber-400/10' };
      case 'paid': return { label: 'Pagamento Aprovado', color: 'text-emerald-400 bg-emerald-400/10' };
      case 'preparing': return { label: 'Em Preparação', color: 'text-blue-400 bg-blue-400/10' };
      case 'ready_for_pickup': return { label: 'Pronto para Retirada', color: 'text-purple-400 bg-purple-400/10' };
      case 'delivering': return { label: 'Saiu para Entrega', color: 'text-indigo-400 bg-indigo-400/10' };
      case 'delivered': return { label: 'Concluído', color: 'text-emerald-500 bg-emerald-500/10' };
      case 'cancelled': return { label: 'Cancelado', color: 'text-red-400 bg-red-400/10' };
      default: return { label: status, color: 'text-muted-foreground bg-white/10' };
    }
  };

  // ArkListTile para Timeline de Pedidos
  const renderOrdersList = (list: any[]) => {
    if (list.length === 0) {
      return (
        <div className="p-12 rounded-3xl border border-white/5 bg-white/5 text-center flex flex-col items-center justify-center space-y-4">
          <Package className="h-16 w-16 text-emerald-400 opacity-20" />
          <div>
            <p className="text-white font-medium text-lg">Nenhum pedido ainda!</p>
            <p className="text-sm text-muted-foreground">Que tal visitar nossa Lojinha e fazer sua primeira compra?</p>
          </div>
        </div>
      );
    }

    return list.map((order: any) => {
      const statusInfo = getOrderStatusInfo(order.status);
      
      return (
        <div key={order.id} className="group relative flex flex-col p-4 mb-3 rounded-2xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.06] transition-all">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
               <div className={`h-12 w-12 rounded-full flex items-center justify-center shrink-0 bg-white/5 text-white`}>
                 <Package className="h-5 w-5 text-muted-foreground" />
               </div>
               <div>
                  <h4 className="font-semibold text-white text-base">Pedido #{order.id}</h4>
                  <p className="text-sm text-muted-foreground font-medium">{format(new Date(order.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
               </div>
            </div>
            <div className="flex flex-col items-end">
               <p className="text-lg font-bold text-white mb-1.5">{formatBRL(Number(order.total))}</p>
               <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusInfo.color}`}>{statusInfo.label}</span>
            </div>
          </div>
          
          <div className="mt-4 pt-4 border-t border-white/5 pl-0 sm:pl-[64px]">
            <div className="space-y-1.5">
              {order.items?.map((item: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center text-sm">
                  <span className="text-white/70 font-medium"><span className="text-muted-foreground mr-1">{item.quantity}x</span> {item.name}</span>
                  <span className="text-muted-foreground">{formatBRL(Number(item.unitPrice))}</span>
                </div>
              ))}
            </div>
            {order.status === 'pending_payment' && order.invoiceId && (
               <Button 
                 variant="ghost" 
                 size="sm"
                 className="mt-4 w-full sm:w-auto text-amber-400 hover:text-amber-300 bg-amber-400/5 hover:bg-amber-400/10"
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
        <div className="space-y-8 focus-visible:outline-none focus-visible:ring-0">
          
          {/* ArkSummaryCard */}
          <div className="relative rounded-3xl overflow-hidden bg-gradient-to-br from-primary/20 via-primary/5 to-transparent border border-primary/20 p-6 sm:p-8 shadow-2xl shadow-primary/5">
            <div className="absolute right-0 top-0 w-96 h-96 bg-primary/20 blur-[100px] rounded-full translate-x-1/3 -translate-y-1/3 pointer-events-none" />
            
            <div className="flex flex-col sm:flex-row justify-between sm:items-end mb-8 gap-4">
              <div>
                <p className="text-muted-foreground text-sm uppercase tracking-widest font-semibold mb-1">Meus Benefícios</p>
                <h2 className="text-2xl sm:text-3xl font-display font-bold text-white">Créditos Disponíveis</h2>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="bg-black/20 backdrop-blur-md rounded-2xl p-5 sm:p-6 border border-white/10 flex flex-col justify-between">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2"><CalendarCheck className="h-4 w-4"/> Pacotes de Diárias</p>
                    <Button onClick={() => navigate('/tutor/store')} variant="outline" size="sm" className="h-8 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
                       Lojinha
                    </Button>
                  </div>
                  <div className="flex items-baseline gap-2">
                     <p className="text-6xl font-display font-bold text-white tracking-tight">{availableCredits}</p>
                     <p className="text-muted-foreground font-medium text-lg">diárias</p>
                  </div>
               </div>
               
               {serviceCreditsData?.data && serviceCreditsData.data.length > 0 ? (
                 <div className="bg-black/20 backdrop-blur-md rounded-2xl p-5 sm:p-6 border border-white/10 flex flex-col justify-start">
                     <p className="text-sm font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-2 mb-4"><Scissors className="h-4 w-4"/> Serviços Pré-pagos</p>
                     <div className="space-y-3">
                       {serviceCreditsData.data.map((credit: any) => {
                         const remaining = credit.totalCredits - credit.usedCredits;
                         return (
                            <div key={credit.id} className="flex justify-between items-center bg-white/5 p-3 rounded-xl border border-white/5">
                               <span className="text-white font-medium text-sm flex items-center gap-2">
                                 <span className="w-2 h-2 rounded-full bg-purple-500"></span>
                                 {credit.itemName}
                               </span>
                               <span className="bg-purple-500/10 border border-purple-500/20 text-purple-300 px-2 py-1 rounded-md text-xs font-bold uppercase tracking-wider">{remaining} disp.</span>
                            </div>
                         )
                       })}
                     </div>
                 </div>
               ) : (
                 <div className="bg-black/10 backdrop-blur-md rounded-2xl p-5 sm:p-6 border border-white/5 border-dashed flex flex-col justify-center items-center text-center opacity-70 min-h-[160px]">
                    <Scissors className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                    <p className="text-sm font-medium text-white mb-1">Sem serviços avulsos</p>
                    <p className="text-xs text-muted-foreground">Compre banhos e extras antecipados na lojinha para economizar.</p>
                 </div>
               )}
            </div>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold flex items-center gap-2 text-white">
                <Receipt className="h-5 w-5 text-amber-400" /> Próximos Pagamentos
              </h3>
            </div>
            {renderInvoiceList(openInvoices.slice(0, 3))}
            {openInvoices.length > 3 && (
              <Button variant="ghost" className="w-full mt-2 text-muted-foreground hover:text-white bg-white/5" onClick={() => {
                const tabsEl = document.querySelector('[role="tablist"] [value="invoices"]') as HTMLElement;
                if (tabsEl) tabsEl.click();
              }}>
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
        <div className="space-y-4 focus-visible:outline-none focus-visible:ring-0">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Abertas e Pendentes</h3>
            <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20">{openInvoices.length} {openInvoices.length === 1 ? 'pendente' : 'pendentes'}</span>
          </div>
          {renderInvoiceList(openInvoices)}
        </div>
      )
    },
    {
      id: "history",
      label: "Histórico",
      content: (
        <div className="space-y-4 focus-visible:outline-none focus-visible:ring-0">
          <h3 className="text-lg font-semibold flex items-center gap-2 text-white mb-4">
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
        <div className="space-y-4 focus-visible:outline-none focus-visible:ring-0">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Acompanhamento da Lojinha</h3>
          </div>
          {renderOrdersList(orders || [])}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold text-white tracking-tight">Minha Carteira</h1>
          <p className="text-muted-foreground mt-1 text-sm">Gerencie faturas, créditos e pacotes da creche.</p>
        </div>
      </div>

      <Tabs defaultTab="overview" tabs={tabsConfig} />

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
          <div className="flex justify-center p-2">
            <img
              src={receiptPreviewUrl}
              alt="Comprovante"
              className="max-w-full max-h-[75vh] rounded-lg object-contain"
            />
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
      <div className="space-y-4">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground flex items-center justify-center">Carregando detalhes...</div>
        ) : !items || items.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum item encontrado nesta fatura.</div>
        ) : (
          <div className="space-y-2 bg-black/20 p-4 rounded-2xl border border-white/5">
            {items.map((item: any) => (
              <div key={item.id} className="flex justify-between items-center py-3 border-b border-white/5 last:border-0">
                <div className="flex flex-col">
                  <p className="text-sm font-semibold text-white">{item.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Qtd: {item.quantity}</p>
                </div>
                <span className="font-bold text-white">{formatBRL(Number(item.amount))}</span>
              </div>
            ))}
          </div>
        )}
        <div className="pt-2 flex justify-end">
          <Button onClick={onClose} className="w-full sm:w-auto">Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}

function PixPaymentModal({ isOpen, onClose, invoice, onUploadClick }: { isOpen: boolean, onClose: () => void, invoice: any, onUploadClick: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: creche } = useGetCreche(user?.crecheId || 1);

  const pixKey = creche?.pixKey || "pix@arkpet.com.br"; 
  const pixName = creche?.pixName || "ArkPet";
  const amount = invoice?.amount ? Number(invoice.amount) / 100 : (invoice?.totalAmount ? Number(invoice.totalAmount) / 100 : 0);

  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [pixPayload, setPixPayload] = useState<string>(pixKey);

  React.useEffect(() => {
    if (isOpen) {
      const payload = generatePixPayload(pixKey, pixName, "BRASIL", amount, `FAT${invoice?.id || '00'}`);
      setPixPayload(payload);
      QRCode.toDataURL(payload, { width: 256, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
        .then(url => setQrCodeUrl(url))
        .catch(console.error);
    }
  }, [isOpen, pixKey, pixName, amount, invoice?.id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(pixPayload);
    toast({ title: "Código Copiado!", description: "Cole no aplicativo do seu banco para pagar." });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Pagamento via Pix`}>
      <div className="space-y-6 text-center pt-2">
        
        <div className="bg-white p-4 rounded-3xl inline-block mx-auto border-4 border-emerald-500/20 shadow-lg shadow-emerald-500/10">
          {qrCodeUrl ? (
            <img src={qrCodeUrl} alt="QR Code Pix" className="h-44 w-44 object-contain" />
          ) : (
            <QrCode className="h-44 w-44 text-slate-900 opacity-10" />
          )}
        </div>
        
        <div>
          <p className="text-4xl font-display font-bold text-white tracking-tight">{formatBRL(invoice?.amount ? Number(invoice.amount) : invoice?.totalAmount || 0)}</p>
          <p className="text-sm font-medium text-emerald-400 mt-2 uppercase tracking-wider">{pixName}</p>
          <p className="text-sm text-muted-foreground mt-2 px-4 leading-relaxed">Abra o app do seu banco e escaneie o código QR acima ou utilize o código Copia e Cola abaixo.</p>
        </div>
        
        <div className="bg-white/5 p-2 pr-2 pl-4 rounded-2xl border border-white/10 flex items-center justify-between gap-3">
          <span className="text-white font-mono text-xs truncate flex-1 text-left opacity-70">{pixPayload}</span>
          <Button variant="secondary" size="sm" onClick={handleCopy} className="shrink-0 bg-white/10 hover:bg-white/20 text-white rounded-xl">
            <Copy className="h-4 w-4 mr-2" /> Copiar Código
          </Button>
        </div>

        <div className="pt-6 flex flex-col gap-3">
          <Button onClick={onUploadClick} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-6 rounded-2xl text-base shadow-lg shadow-emerald-500/20">
            <UploadCloud className="mr-2 h-5 w-5" /> Já paguei, enviar comprovante
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full text-muted-foreground hover:text-white rounded-2xl py-6">
            Pagar mais tarde
          </Button>
        </div>
      </div>
    </Modal>
  );
}
