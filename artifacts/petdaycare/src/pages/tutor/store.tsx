import React, { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListCatalogue, useCreateOrder, useCreche } from "@/hooks/use-financial";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { PackageOpen, ShoppingCart, Loader2, ChevronRight, Minus, Plus, ShoppingBag, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useLocation } from "wouter";

function formatBRL(value: number) {
  return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function TutorStore() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const tutorId = user?.id;
  const { toast } = useToast();

  const { data: catalogue, isLoading } = useListCatalogue(crecheId);
  const { data: creche } = useCreche(crecheId);
  const createOrderMutation = useCreateOrder(crecheId);

  const [, navigate] = useLocation();
  const [pixModal, setPixModal] = useState<{open: boolean, invoice: any, item: any}>({ open: false, invoice: null, item: null });

  // Cart State
  const [cart, setCart] = useState<{ item: any, quantity: number }[]>([]);
  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState("");

  const addToCart = (item: any) => {
    setCart(prev => {
      const existing = prev.find(i => i.item.id === item.id);
      if (existing) {
        if (item.stockQuantity !== null && existing.quantity >= item.stockQuantity) {
          toast({ title: "Estoque insuficiente", variant: "destructive" });
          return prev;
        }
        return prev.map(i => i.item.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { item, quantity: 1 }];
    });
    toast({ title: "Adicionado ao carrinho", description: `${item.name} foi adicionado.` });
  };

  const removeFromCart = (itemId: number) => {
    setCart(prev => prev.filter(i => i.item.id !== itemId));
  };

  const updateQuantity = (itemId: number, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.item.id === itemId) {
        const newQ = i.quantity + delta;
        if (newQ < 1) return i;
        if (i.item.stockQuantity !== null && newQ > i.item.stockQuantity) {
          toast({ title: "Estoque insuficiente", variant: "destructive" });
          return i;
        }
        return { ...i, quantity: newQ };
      }
      return i;
    }));
  };

  const cartSubtotal = cart.reduce((acc, curr) => acc + (curr.item.basePrice * curr.quantity), 0);
  const deliveryFee = deliveryMethod === 'delivery' && creche?.deliveryType === 'fixed' ? Number(creche?.deliveryFee || 0) : 0;
  const cartTotal = cartSubtotal + deliveryFee;

  const handleCheckout = () => {
    if (deliveryMethod === 'delivery' && !deliveryAddress.trim()) {
      toast({ title: "Atenção", description: "Por favor informe o endereço de entrega.", variant: "destructive" });
      return;
    }
    
    createOrderMutation.mutate({
      items: cart.map(c => ({ catalogueItemId: c.item.id, quantity: c.quantity })),
      deliveryMethod,
      deliveryAddress,
      deliveryFee
    }, {
      onSuccess: (data) => {
        setCart([]);
        setCartModalOpen(false);
        setPixModal({ open: true, invoice: data.invoice, item: { name: "Seu Pedido", creditsAmount: 0 } });
      },
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };


  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('purchased') === 'true') {
      toast({
        title: "Sucesso!",
        description: "Pagamento confirmado! Suas diárias foram liberadas.",
        variant: "default" /* success */,
      });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando loja...</div>;

  const items = catalogue?.filter((item: any) => item.isActive) || [];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto pb-24">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-display font-bold text-white tracking-tight">Lojinha</h1>
          <p className="text-muted-foreground mt-1">Compre produtos, serviços e pacotes de diárias.</p>
        </div>
        {cart.length > 0 && (
          <Button onClick={() => setCartModalOpen(true)} className="relative bg-emerald-500 hover:bg-emerald-600 text-white rounded-full p-4 h-auto">
            <ShoppingBag className="h-6 w-6" />
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center">
              {cart.reduce((a, b) => a + b.quantity, 0)}
            </span>
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="p-12 text-center border border-white/10 rounded-2xl bg-white/5">
          <PackageOpen className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-4" />
          <h3 className="text-lg font-medium text-white">Nenhum item disponível</h3>
          <p className="text-muted-foreground mt-1">A creche não possui itens à venda no momento.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item: any) => (
            <Card key={item.id} className="overflow-hidden group border-white/10 hover:border-emerald-500/50 transition-colors flex flex-col">
              <CardContent className="p-0 flex flex-col flex-1">
                <div className="h-48 bg-gradient-to-br from-emerald-500/10 to-emerald-900/30 relative flex items-center justify-center overflow-hidden">
                  {item.mediaUrls && item.mediaUrls.length > 0 ? (
                    <img src={item.mediaUrls[0]} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <PackageOpen className="h-16 w-16 text-emerald-400 group-hover:scale-110 transition-transform duration-500" />
                  )}
                  <div className="absolute top-4 right-4">
                    <Badge className="bg-emerald-500 text-white uppercase text-[10px] tracking-wider">{item.type === 'package' ? 'Pacote' : item.category || item.type}</Badge>
                  </div>
                </div>
                <div className="p-6 flex flex-col flex-1 space-y-4">
                  <div>
                    <h3 className="text-xl font-bold text-white mb-1">{item.name}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {item.description || "Sem descrição."}
                    </p>
                  </div>
                  
                  <div className="mt-auto pt-4 border-t border-white/10">
                    <p className="text-2xl font-display font-bold text-white">
                      {formatBRL(item.basePrice)}
                    </p>
                    
                    {item.type === 'package' && item.creditsAmount && (
                      <p className="text-xs text-muted-foreground mt-1">Inclui {item.creditsAmount} diárias</p>
                    )}
                    
                    {item.type === 'product' && item.stockQuantity !== null && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Estoque: <span className={item.stockQuantity === 0 ? "text-red-400 font-bold" : "text-emerald-400 font-bold"}>{item.stockQuantity} un.</span>
                      </p>
                    )}
                  </div>
                  
                  <Button 
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm"
                    disabled={item.type === 'product' && item.stockQuantity === 0}
                    onClick={() => addToCart(item)}
                  >
                    <ShoppingCart className="mr-2 h-4 w-4" /> {(item.type === 'product' && item.stockQuantity === 0) ? 'Esgotado' : 'Adicionar ao Carrinho'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Cart Modal */}
      {cartModalOpen && (
        <Modal isOpen={true} onClose={() => setCartModalOpen(false)} title="Seu Carrinho" className="max-w-md">
          <div className="space-y-6">
            <div className="max-h-[50vh] overflow-y-auto space-y-4 pr-2">
              {cart.map((cartItem) => (
                <div key={cartItem.item.id} className="flex gap-4 items-center bg-white/5 p-3 rounded-lg border border-white/5">
                  <div className="w-16 h-16 rounded-md bg-white/10 flex items-center justify-center overflow-hidden shrink-0">
                    {cartItem.item.mediaUrls?.[0] ? (
                      <img src={cartItem.item.mediaUrls[0]} alt="prod" className="w-full h-full object-cover" />
                    ) : (
                      <PackageOpen className="h-6 w-6 text-white/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate text-sm">{cartItem.item.name}</p>
                    <p className="text-emerald-400 font-bold text-sm">{formatBRL(cartItem.item.basePrice)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" className="h-6 w-6 rounded-full" onClick={() => updateQuantity(cartItem.item.id, -1)}>
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="text-white text-sm w-4 text-center">{cartItem.quantity}</span>
                    <Button variant="outline" size="icon" className="h-6 w-6 rounded-full" onClick={() => updateQuantity(cartItem.item.id, 1)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-400" onClick={() => removeFromCart(cartItem.item.id)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="border-t border-white/10 pt-4 space-y-4">
              <div className="space-y-3">
                <label className="text-sm font-medium text-white">Método de Entrega</label>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    className={`p-3 text-sm rounded-lg border transition-colors ${deliveryMethod === 'pickup' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'border-white/10 text-muted-foreground hover:bg-white/5'}`}
                    onClick={() => setDeliveryMethod('pickup')}
                  >
                    Retirar na Creche
                  </button>
                  <button 
                    className={`p-3 text-sm rounded-lg border transition-colors ${deliveryMethod === 'delivery' ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'border-white/10 text-muted-foreground hover:bg-white/5'}`}
                    onClick={() => setDeliveryMethod('delivery')}
                  >
                    Receber em Casa
                  </button>
                </div>
              </div>

              {deliveryMethod === 'delivery' && (
                <div className="space-y-2 animate-in slide-in-from-top-2">
                  <label className="text-sm font-medium text-white">Endereço de Entrega Completo</label>
                  <Input 
                    placeholder="Rua, Número, Bairro, CEP" 
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                  />
                  {creche?.deliveryType === 'on_demand' && (
                    <p className="text-xs text-yellow-400">O valor do frete será cobrado separadamente após combinarmos a entrega com você.</p>
                  )}
                </div>
              )}

              <div className="space-y-2 text-sm pt-2">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatBRL(cartSubtotal)}</span>
                </div>
                {deliveryMethod === 'delivery' && creche?.deliveryType === 'fixed' && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Taxa de Entrega</span>
                    <span>{formatBRL(deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-white/10">
                  <span>Total a Pagar</span>
                  <span className="text-emerald-400">{formatBRL(cartTotal)}</span>
                </div>
              </div>

              <Button 
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-6"
                onClick={handleCheckout}
                isLoading={createOrderMutation.isPending}
              >
                Finalizar Pedido com Pix
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Pix Modal (shared for packages and products) */}
      {pixModal.open && (
        <Modal isOpen={true} onClose={() => setPixModal({ open: false, invoice: null, item: null })} title="Pedido gerado com sucesso! 🎉">
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-4">
              <p className="text-sm font-medium text-amber-400">⏳ Seu pedido será processado após o pagamento</p>
              <p className="text-sm text-muted-foreground mt-1">
                Envie o comprovante na aba Financeiro para liberarmos a retirada/entrega.
              </p>
            </div>

            <div className="space-y-2 text-white">
              <p className="text-sm font-medium">Próximos passos:</p>
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Realize o Pix ou Transferência no valor de <strong className="text-white">{formatBRL(pixModal.invoice?.amount || 0)}</strong></li>
                <li>Acesse a aba <strong>"Meu Financeiro"</strong></li>
                <li>Localize a fatura <strong>#{pixModal.invoice?.id}</strong> e anexe o comprovante</li>
                <li>A creche fará a aprovação e você será notificado</li>
              </ol>
            </div>
            
            <div className="flex gap-2 justify-end pt-4 border-t border-white/10">
              <Button variant="outline" onClick={() => setPixModal({ open: false, invoice: null, item: null })}>Continuar Comprando</Button>
              <Button onClick={() => { setPixModal({ open: false, invoice: null, item: null }); navigate('/tutor/financial'); }}>Ir para Meu Financeiro</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
