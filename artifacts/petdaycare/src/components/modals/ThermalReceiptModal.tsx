import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { QrCode, Printer, Share2 } from 'lucide-react';

function formatBRL(value: number) {
  return (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function ThermalReceiptModal({ invoiceId, onClose }: { invoiceId: number, onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;
    const fetchReceiptData = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        const userRes = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
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

  const handlePrint = () => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = `/receipt/${invoiceId}`;
    document.body.appendChild(iframe);
    
    // The iframe route will automatically call window.print() inside it
    // We clean it up after a while to avoid memory leaks
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 60000); // Remove after 1 minute
  };

  const handleShare = async () => {
    if (!data) return;
    
    const itemsText = data.items?.map((i: any) => `${i.quantity}x ${i.description} - ${formatBRL(Number(i.amount))}`).join('\n') || '';
    
    const text = `🧾 *RECIBO DE PRESTAÇÃO DE SERVIÇOS* 🧾
*${data.creche?.name || "Creche ArkPet"}*
Fatura: #${data.invoice.id}
Emissão: ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}

*Cliente:* ${data.tutor?.name || "Consumidor Padrão"}${data.tutor?.cpf ? `\n*CPF:* ${data.tutor.cpf}` : ''}

*Itens:*
${itemsText}

*Valor Total:* ${formatBRL(Number(data.invoice.amount))}
*Situação:* PAGO (${data.invoice.paymentMethod || "Não informado"})

🐾 Gerado pelo aplicativo ArkPet`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Recibo ArkPet #${data.invoice.id}`,
          text: text,
        });
      } catch (err) {
        console.log("Compartilhamento cancelado ou não suportado", err);
      }
    } else {
      // Fallback para WhatsApp Web/Desktop
      const encodedText = encodeURIComponent(text);
      window.open(`https://wa.me/?text=${encodedText}`, '_blank');
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Visualização do Recibo" description={`Fatura #${invoiceId}`}>
      <div className="flex flex-col items-center">
        {loading && <div className="py-12 text-sm text-muted-foreground font-mono">Buscando dados...</div>}
        {error && <div className="py-12 text-sm text-red-400 font-mono">{error}</div>}
        
        {data && (
          <div className="bg-white text-black font-mono text-[10px] sm:text-xs p-4 shadow-sm w-full max-w-[300px] mb-6 overflow-hidden relative border border-gray-200">
            {/* Header */}
            <div className="text-center mb-4">
              <h1 className="font-bold text-sm uppercase">{data.creche?.name || "Creche ArkPet"}</h1>
              <p>{data.creche?.address || "Endereço não cadastrado"}</p>
              <p>FONE: {data.creche?.phone || "Não informado"}</p>
              <div className="my-2 border-b border-dashed border-black"></div>
              <p className="font-bold text-[10px]">RECIBO DE PRESTAÇÃO DE SERVIÇOS</p>
              <p className="font-bold text-[10px] uppercase">Não é Documento Fiscal</p>
              <div className="my-2 border-b border-dashed border-black"></div>
            </div>

            {/* Items */}
            <div className="flex justify-between font-bold mb-1 border-b border-black pb-1">
              <span className="w-8 text-left">QTD</span>
              <span className="flex-1 text-left px-1">DESCRIÇÃO</span>
              <span className="w-16 text-right">TOTAL</span>
            </div>
            <div className="mb-4">
              {data.items?.map((item: any, idx: number) => (
                <div key={idx} className="flex justify-between py-1 border-b border-dotted border-gray-400 last:border-0">
                  <span className="w-8 text-left">{item.quantity}x</span>
                  <span className="flex-1 text-left px-1 truncate">{item.description}</span>
                  <span className="w-16 text-right">{formatBRL(Number(item.amount))}</span>
                </div>
              ))}
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            {/* Totals */}
            <div className="space-y-1 mb-4">
              <div className="flex justify-between font-bold">
                <span>Valor Total</span>
                <span>{formatBRL(Number(data.invoice.amount))}</span>
              </div>
              <div className="flex justify-between">
                <span>Pagamento</span>
                <span className="uppercase">{data.invoice.paymentMethod || "Não informado"}</span>
              </div>
            </div>

            <div className="border-t border-dashed border-black my-2"></div>

            {/* Consumer */}
            <div className="text-center mb-4 text-[10px]">
              <p className="font-bold">DADOS DO CLIENTE</p>
              <p className="uppercase">{data.tutor?.name || "Consumidor Padrão"}</p>
              {data.tutor?.cpf && <p>CPF: {data.tutor.cpf}</p>}
            </div>

            {/* Footer */}
            <div className="text-center text-[10px] flex flex-col items-center">
              <QrCode className="h-16 w-16 mb-2" />
              <p>Fatura #{data.invoice.id}</p>
              <p>Emissão: {format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}</p>
              <div className="my-2 border-b border-dashed border-black w-full"></div>
              <p>Gerado pelo sistema ArkPet</p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row justify-end gap-2 w-full pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose} className="sm:mr-auto">Cancelar</Button>
          <Button onClick={handleShare} disabled={!data || loading || !!error} className="bg-blue-500 hover:bg-blue-600 text-white border-0">
            <Share2 className="mr-2 h-4 w-4" /> Compartilhar
          </Button>
          <Button onClick={handlePrint} disabled={!data || loading || !!error} className="bg-emerald-500 hover:bg-emerald-600 text-white border-0">
            <Printer className="mr-2 h-4 w-4" /> Imprimir
          </Button>
        </div>
      </div>
    </Modal>
  );
}
