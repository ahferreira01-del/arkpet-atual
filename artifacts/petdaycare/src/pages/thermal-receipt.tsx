import React, { useEffect, useState } from 'react';
import { useRoute } from 'wouter';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { QrCode, X } from 'lucide-react';
import { formatCentsToBRL } from "@/lib/money";

export default function ThermalReceipt() {
  const [, params] = useRoute('/receipt/:invoiceId');
  const invoiceId = params?.invoiceId ? Number(params.invoiceId) : null;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) {
      setError("Fatura não identificada");
      setLoading(false);
      return;
    }

    const fetchReceiptData = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        // Fetch User to get crecheId - simplified for this component
        const userRes = await fetch('/api/auth/me', {
           headers: { Authorization: `Bearer ${token}` }
        });
        if (!userRes.ok) throw new Error("Não autorizado");
        const userData = await userRes.json();
        const crecheId = userData.crecheId || 1;

        const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/receipt-data`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error("Erro ao carregar dados do recibo");
        
        const receiptData = await res.json();
        setData(receiptData);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchReceiptData();
  }, [invoiceId]);

  useEffect(() => {
    // Automatically trigger print dialog when data is loaded
    if (data && !loading && !error) {
      setTimeout(() => {
        window.print();
      }, 500);
    }
  }, [data, loading, error]);

  if (loading) return <div className="p-8 font-mono text-sm bg-background min-h-screen text-foreground">Carregando...</div>;
  if (error) return <div className="p-8 font-mono text-sm text-destructive bg-background min-h-screen">Erro: {error}</div>;
  if (!data) return null;

  const { invoice, items, creche, tutor } = data;

  return (
    <div className="bg-background min-h-screen flex justify-center p-0 m-0 print:bg-transparent sm:py-8 sm:px-4">
      {/* Container simulating 80mm thermal paper */}
      <div className="w-[300px] max-w-full bg-white text-black font-mono text-xs p-4 shadow-sm print:shadow-none print:p-0 print:w-full">
        
        {/* Header */}
        <div className="text-center mb-4">
          <h1 className="font-bold text-sm uppercase">{creche?.name || "Creche ArkPet"}</h1>
          <p>{creche?.address || "Endereço não cadastrado"}</p>
          <p>FONE: {creche?.phone || "Não informado"}</p>
          <div className="my-2 border-b border-dashed border-black"></div>
          <p className="font-bold text-[10px]">RECIBO DE PRESTAÇÃO DE SERVIÇOS</p>
          <p className="font-bold text-[10px] uppercase">Não é Documento Fiscal</p>
          <div className="my-2 border-b border-dashed border-black"></div>
        </div>

        {/* Items Table Header */}
        <div className="flex justify-between font-bold mb-1 border-b border-black pb-1">
          <span className="w-8 text-left">QTD</span>
          <span className="flex-1 text-left px-1">DESCRIÇÃO</span>
          <span className="w-16 text-right">TOTAL</span>
        </div>

        {/* Items List */}
        <div className="mb-4">
          {items?.map((item: any, idx: number) => (
            <div key={idx} className="flex justify-between py-1 border-b border-dotted border-gray-400 last:border-0">
              <span className="w-8 text-left">{item.quantity}x</span>
              <span className="flex-1 text-left px-1 break-words whitespace-normal leading-tight">{item.description}</span>
              <span className="w-16 text-right">{formatCentsToBRL(Number(item.amount))}</span>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-black my-2"></div>

        {/* Totals */}
        <div className="space-y-1 mb-4">
          <div className="flex justify-between font-bold">
            <span>Valor Total</span>
            <span>{formatCentsToBRL(Number(invoice.amount))}</span>
          </div>
          <div className="flex justify-between">
            <span>Forma de Pagamento</span>
            <span className="uppercase">{invoice.paymentMethod || "Não informado"}</span>
          </div>
          <div className="flex justify-between">
            <span>Situação</span>
            <span className="uppercase font-bold">{invoice.status === 'paid' ? 'PAGO' : 'PENDENTE'}</span>
          </div>
        </div>

        <div className="border-t border-dashed border-black my-2"></div>

        {/* Consumer Info */}
        <div className="text-center mb-4 text-[10px]">
          <p className="font-bold">DADOS DO CLIENTE</p>
          <p className="uppercase">{tutor?.name || "Consumidor Padrão"}</p>
          {tutor?.cpf && <p>CPF: {tutor.cpf}</p>}
        </div>

        {/* Footer */}
        <div className="text-center text-[10px] flex flex-col items-center">
          <QrCode className="h-16 w-16 mb-2" />
          <p>Fatura #{invoice.id}</p>
          <p>Emissão: {format(new Date(), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}</p>
          <div className="my-2 border-b border-dashed border-black w-full"></div>
          <p>Gerado pelo sistema ArkPet</p>
          <p>Obrigado pela preferência!</p>
        </div>

      </div>
      
      {/* Hide close button when printing */}
      <div className="fixed top-4 right-4 sm:top-6 sm:right-6 print:hidden">
         <button 
           onClick={() => window.close()} 
           className="bg-secondary text-foreground border border-border px-5 h-11 flex items-center gap-2 rounded-full font-sans text-[15px] font-semibold hover:bg-secondary/80 transition-colors shadow-sm"
         >
           <X className="h-5 w-5" /> Fechar
         </button>
      </div>
    </div>
  );
}
