import React, { useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useGetCreche } from "@workspace/api-client-react";
import { useTutorInvoices, useStripeCheckout, usePackagesBalance, useListOrders } from "@/hooks/use-financial";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Receipt, UploadCloud, CheckCircle2, History, ExternalLink, CreditCard, Eye, Package, ShoppingCart, QrCode, Copy } from "lucide-react";
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
  const [pixInvoice, setPixInvoice] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePixUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingFor) return;
    
    toast({ title: "Enviando comprovante...", description: "Aguarde um momento." });
    
    setTimeout(() => {
      toast({ 
        title: "Comprovante enviado!", 
        description: "A creche irá avaliar seu comprovante em breve.",
        variant: "default"
      });
      refetch();
      setUploadingFor(null);
    }, 1500);
    
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handlePayOnline = (invoiceId: number) => {
    stripeMutation.mutate({ invoiceId }, {
      onSuccess: (data: any) => {
        if (data.checkoutUrl) window.open(data.checkoutUrl, "_blank");
      },
      onError: (err: any) => {
        toast({ title: "Erro", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleViewReceipt = async (invoiceId: number) => {
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/receipt-url`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Comprovante não encontrado");
      const data = await res.json();
      if (data.url) window.open(data.url, "_blank");
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    }
  };

  const { data: packagesData, isLoading: isLoadingPackages } = usePackagesBalance(crecheId);
  const availableCredits = packagesData?.availableCredits || 0;

  if (isLoading || isLoadingPackages || isLoadingOrders) return <div className="p-8 text-center text-muted-foreground">Carregando carteira...</div>;

  const invoiceList = invoices?.data || (Array.isArray(invoices) ? invoices : []);
  const openInvoices = invoiceList.filter((inv: any) => inv.status !== "paid");
  const paidInvoices = invoiceList.filter((inv: any) => inv.status === "paid");

  const renderInvoiceList = (list: any[]) => {
    if (list.length === 0) {
      return (
        <div className="p-8 rounded-2xl border border-white/5 bg-white/5 text-center flex flex-col items-center justify-center space-y-3">
          <CheckCircle2 className="h-10 w-10 text-emerald-400 opacity-50" />
          <div>
            <p className="text-white font-medium">Tudo em dia!</p>
            <p className="text-sm text-muted-foreground">Você não possui faturas em aberto no momento.</p>
          </div>
        </div>
      );
    }

    return list.map((inv: any) => (
      <Card key={inv.id} className="border-white/10 bg-black/40 hover:bg-black/60 transition-colors mb-4">
        <CardContent className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h4 className="font-medium text-white text-lg">Fatura #{inv.id}</h4>
                {inv.status === "overdue" && <Badge variant="destructive">Vencida</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">
                Vencimento: {format(new Date(inv.dueDate), "dd/MM/yyyy", { locale: ptBR })}
              </p>
            </div>
            <div className="flex flex-col sm:items-end justify-center w-full sm:w-auto gap-3">
              <div className="flex items-center gap-2 pr-2">
                <p className="text-2xl font-bold text-white">{formatBRL(inv.amount ? Number(inv.amount) : inv.totalAmount)}</p>
                <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground hover:text-white" onClick={() => setDetailsFor(inv.id)}>
                  <Eye className="h-4 w-4 mr-1" /> Detalhes
                </Button>
              </div>
              {inv.status === "awaiting_confirmation" ? (
                <Badge variant="outline" className="text-amber-400 border-amber-500/30 self-end">
                  Em análise
                </Badge>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                  <Button 
                    onClick={() => setPixInvoice(inv)}
                    variant="outline"
                    className="w-full sm:w-auto border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                  >
                    <QrCode className="mr-2 h-4 w-4" /> Pagar via Pix
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    ));
  };

  const getOrderStatusInfo = (status: string) => {
    switch(status) {
      case 'pending_payment': return { label: 'Aguardando Pagamento', color: 'text-amber-400', border: 'border-amber-400/30' };
      case 'paid': return { label: 'Pagamento Aprovado', color: 'text-emerald-400', border: 'border-emerald-400/30' };
      case 'preparing': return { label: 'Em Preparação', color: 'text-blue-400', border: 'border-blue-400/30' };
      case 'ready_for_pickup': return { label: 'Pronto para Retirada', color: 'text-purple-400', border: 'border-purple-400/30' };
      case 'delivering': return { label: 'Saiu para Entrega', color: 'text-indigo-400', border: 'border-indigo-400/30' };
      case 'delivered': return { label: 'Concluído', color: 'text-emerald-500', border: 'border-emerald-500/30' };
      case 'cancelled': return { label: 'Cancelado', color: 'text-red-400', border: 'border-red-400/30' };
      default: return { label: status, color: 'text-muted-foreground', border: 'border-white/10' };
    }
  };

  const renderOrdersList = (list: any[]) => {
    if (list.length === 0) {
      return (
        <div className="p-8 rounded-2xl border border-white/5 bg-white/5 text-center flex flex-col items-center justify-center space-y-3">
          <Package className="h-10 w-10 text-emerald-400 opacity-50" />
          <div>
            <p className="text-white font-medium">Nenhum pedido ainda!</p>
            <p className="text-sm text-muted-foreground">Que tal visitar nossa Lojinha e fazer sua primeira compra?</p>
          </div>
        </div>
      );
    }

    return list.map((order: any) => {
      const statusInfo = getOrderStatusInfo(order.status);
      
      return (
        <Card key={order.id} className="border-white/10 bg-black/40 mb-4 overflow-hidden">
          <CardContent className="p-0">
            <div className="p-5 border-b border-white/5 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div>
                <p className="font-medium text-white text-lg">Pedido #{order.id}</p>
                <p className="text-sm text-muted-foreground">Realizado em {format(new Date(order.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant="outline" className={`${statusInfo.color} ${statusInfo.border} px-3 py-1 text-xs uppercase tracking-wider`}>
                  {statusInfo.label}
                </Badge>
                <p className="text-lg font-bold text-white">{formatBRL(Number(order.total))}</p>
              </div>
            </div>
            
            <div className="p-5 bg-white/[0.02]">
              <p className="text-sm font-semibold text-white mb-3">Itens do Pedido:</p>
              <div className="space-y-3">
                {order.items?.map((item: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-md bg-white/10 flex items-center justify-center shrink-0 overflow-hidden">
                      {item.mediaUrls?.[0] ? (
                        <img src={item.mediaUrls[0]} alt="item" className="w-full h-full object-cover" />
                      ) : (
                        <Package className="h-5 w-5 text-white/50" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm text-white font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.quantity}x {formatBRL(Number(item.unitPrice))}</p>
                    </div>
                  </div>
                ))}
              </div>
              
              {order.status === 'pending_payment' && order.invoiceId && (
                <div className="mt-6 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <p className="text-sm text-amber-400 flex-1">Este pedido está aguardando confirmação do pagamento (Pix).</p>
                  <Button 
                    variant="outline" 
                    className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300 w-full sm:w-auto"
                    onClick={() => {
                      const invoice = (invoices?.data || invoices)?.find((i:any) => i.id === order.invoiceId);
                      if (invoice) {
                        const tabsEl = document.querySelector('[role="tablist"] [value="invoices"]') as HTMLElement;
                        if (tabsEl) tabsEl.click();
                        setPixInvoice(invoice);
                      }
                    }}
                  >
                    <QrCode className="mr-2 h-4 w-4" /> Anexar Comprovante
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      );
    });
  };

  const tabsConfig = [
    {
      id: "overview",
      label: "Visão Geral",
      content: (
        <div className="space-y-8 focus-visible:outline-none focus-visible:ring-0">
          <Card className="bg-gradient-to-br from-emerald-500/20 via-emerald-500/5 to-transparent border-emerald-500/30 shadow-[0_0_40px_rgba(16,185,129,0.15)] overflow-hidden relative">
            <div className="absolute right-0 top-0 w-64 h-64 bg-emerald-500/10 blur-3xl rounded-full translate-x-1/3 -translate-y-1/3 pointer-events-none" />
            <CardContent className="p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between h-full gap-6">
              <div>
                <p className="text-sm font-medium text-emerald-400 mb-2 uppercase tracking-wider">Diárias Disponíveis</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-6xl font-display font-bold text-white tracking-tight">{availableCredits}</p>
                  <p className="text-muted-foreground font-medium text-lg">diárias</p>
                </div>
                <p className="text-sm text-muted-foreground mt-2">Liberadas para agendamentos imediatos.</p>
              </div>
              <div className="w-full sm:w-auto">
                <Button 
                  size="lg" 
                  className="w-full sm:w-auto bg-emerald-500 hover:bg-emerald-600 text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] border-0" 
                  onClick={() => navigate('/tutor/store')}
                >
                  <ShoppingCart className="mr-2 h-5 w-5" /> Acessar Lojinha
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Receipt className="h-5 w-5 text-amber-400" /> Faturas Recentes
            </h3>
            {renderInvoiceList(openInvoices.slice(0, 2))}
            {openInvoices.length > 2 && (
              <p className="text-sm text-muted-foreground text-center">
                Você tem mais {openInvoices.length - 2} fatura(s) em aberto. Acesse a aba Faturas.
              </p>
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
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-white">Todas as Faturas Pendentes</h3>
            <Badge variant="outline" className="border-amber-500/30 text-amber-400">{openInvoices.length} pendentes</Badge>
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
          <h3 className="text-lg font-semibold flex items-center gap-2 text-muted-foreground mb-4">
            <History className="h-5 w-5" /> Histórico de Pagamentos
          </h3>
          {paidInvoices.length > 0 ? (
            <div className="space-y-2">
              {paidInvoices.map((inv: any) => (
                <div key={inv.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border border-white/5 bg-white/5 gap-3">
                  <div>
                    <p className="font-medium text-white text-sm">Fatura #{inv.id}</p>
                    <p className="text-xs text-muted-foreground">
                      Pago em {inv.updatedAt ? format(new Date(inv.updatedAt), "dd/MM/yyyy", { locale: ptBR }) : "Desconhecido"}
                    </p>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 justify-between sm:justify-end">
                    <p className="font-medium text-emerald-400 mr-2">{formatBRL(inv.amount ? Number(inv.amount) : inv.totalAmount)}</p>
                    <Button variant="ghost" size="sm" onClick={() => setDetailsFor(inv.id)} className="h-8 text-xs text-muted-foreground hover:text-white">
                      <Eye className="mr-1 h-3 w-3" /> Detalhes
                    </Button>
                    {inv.receiptPhotoPath && (
                      <Button variant="ghost" size="sm" onClick={() => handleViewReceipt(inv.id)} className="h-8 text-xs text-muted-foreground hover:text-white">
                        <ExternalLink className="mr-1 h-3 w-3" /> Recibo
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 rounded-2xl border border-white/5 bg-white/5 text-center flex flex-col items-center justify-center space-y-3">
              <Receipt className="h-10 w-10 text-muted-foreground opacity-50" />
              <p className="text-sm text-muted-foreground">Nenhum pagamento registrado no seu histórico.</p>
            </div>
          )}
        </div>
      )
    },
    {
      id: "orders",
      label: "Meus Pedidos",
      content: (
        <div className="space-y-4 focus-visible:outline-none focus-visible:ring-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-white">Acompanhamento de Pedidos</h3>
          </div>
          {renderOrdersList(orders || [])}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto pb-12">
      <div>
        <h1 className="text-4xl font-display font-bold text-white tracking-tight">Minha Carteira</h1>
        <p className="text-muted-foreground mt-1">Gerencie seu saldo de diárias e suas faturas.</p>
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
    </div>
  );
}

function InvoiceDetailsModal({ isOpen, onClose, invoiceId, crecheId }: { isOpen: boolean, onClose: () => void, invoiceId: number, crecheId: number }) {
  const { data: items, isLoading } = useInvoiceItems(crecheId, invoiceId);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Detalhes da Fatura #${invoiceId}`}>
      <div className="space-y-4">
        {isLoading ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Carregando detalhes...</div>
        ) : !items || items.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">Nenhum item encontrado nesta fatura.</div>
        ) : (
          <div className="space-y-2">
            {items.map((item: any) => (
              <div key={item.id} className="flex justify-between items-center p-3 rounded-lg border border-white/10 bg-white/5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <Package className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{item.description}</p>
                    <p className="text-xs text-muted-foreground">Qtd: {item.quantity}</p>
                  </div>
                </div>
                <span className="font-medium text-white">{formatBRL(Number(item.amount))}</span>
              </div>
            ))}
          </div>
        )}
        <div className="pt-4 border-t border-white/10 flex justify-end">
          <Button onClick={onClose}>Fechar</Button>
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
      // Gera o payload do Pix
      const payload = generatePixPayload(pixKey, pixName, "BRASIL", amount, `FAT${invoice?.id || '00'}`);
      setPixPayload(payload);
      // Converte para QR Code
      QRCode.toDataURL(payload, { width: 256, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } })
        .then(url => setQrCodeUrl(url))
        .catch(console.error);
    }
  }, [isOpen, pixKey, pixName, amount, invoice?.id]);

  const handleCopy = () => {
    navigator.clipboard.writeText(pixPayload);
    toast({ title: "BR Code Copiado (Pix Copia e Cola)!", description: "Cole no aplicativo do seu banco para pagar." });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Pagamento via Pix`}>
      <div className="space-y-6 text-center pt-2">
        
        <div className="bg-white p-4 rounded-2xl inline-block mx-auto border-4 border-emerald-500/20 shadow-lg shadow-emerald-500/10">
          {qrCodeUrl ? (
            <img src={qrCodeUrl} alt="QR Code Pix" className="h-40 w-40 object-contain" />
          ) : (
            <QrCode className="h-40 w-40 text-slate-900" />
          )}
        </div>
        
        <div>
          <p className="text-3xl font-display font-bold text-white">{formatBRL(invoice?.amount ? Number(invoice.amount) : invoice?.totalAmount || 0)}</p>
          <p className="text-sm font-medium text-white mt-2">{pixName}</p>
          <p className="text-sm text-muted-foreground mt-1 px-4">Escaneie o QR Code acima pelo app do seu banco ou copie a chave Pix abaixo.</p>
        </div>
        
        <div className="bg-black/40 p-3 rounded-xl border border-white/10 flex items-center justify-between gap-3">
          <span className="text-emerald-400 font-mono text-sm truncate flex-1 text-left pl-2 opacity-80">{pixPayload}</span>
          <Button variant="secondary" size="sm" onClick={handleCopy} className="shrink-0">
            <Copy className="h-4 w-4 mr-2" /> Pix Copia e Cola
          </Button>
        </div>

        <div className="pt-6 border-t border-white/10 flex flex-col gap-3">
          <Button onClick={onUploadClick} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-6 text-base shadow-lg shadow-emerald-500/20">
            <UploadCloud className="mr-2 h-5 w-5" /> Já paguei, anexar comprovante
          </Button>
          <Button variant="ghost" onClick={onClose} className="w-full text-muted-foreground hover:text-white">
            Cancelar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
