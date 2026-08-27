import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { CheckCircle, Clock } from "lucide-react";
import { useListOrders, useUpdateOrderStatus, useApproveReceipt } from "@/hooks/use-financial";
import { useToast } from "@/hooks/use-toast";
import { formatCentsToBRL } from "@/lib/money";

export function OrdersTab({ crecheId }: { crecheId: number }) {
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
