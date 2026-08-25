import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useListCatalogue, useCreateOrder, useCreche } from "@/hooks/use-financial";
import { buildMediaSrc, getMediaToken } from "@/features/feed/utils/media.utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { PackageOpen, ShoppingCart, Loader2, ChevronRight, Minus, Plus, ShoppingBag, X, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useLocation } from "wouter";
import { formatCentsToBRL } from "@/lib/money";

function useMediaToken() {
  const [token, setToken] = useState(() => getMediaToken());
  useEffect(() => {
    const refresh = () => setToken(getMediaToken());
    window.addEventListener("media_token_refresh", refresh);
    return () => window.removeEventListener("media_token_refresh", refresh);
  }, []);
  return token;
}

function StoreImage({
  src,
  alt,
  fallback,
  className,
}: {
  src?: string | null;
  alt: string;
  fallback: React.ReactNode;
  className?: string;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  if (!src || hasError) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setHasError(true)}
    />
  );
}

export default function TutorStore() {
  const { user } = useAuth();
  const crecheId = user?.crecheId as number;
  const tutorId = user?.id;
  const { toast } = useToast();
  const mediaToken = useMediaToken();

  const { data: catalogue, isLoading } = useListCatalogue(crecheId, {
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const { data: creche } = useCreche(crecheId);
  const createOrderMutation = useCreateOrder(crecheId);

  const [, navigate] = useLocation();
  const [pixModal, setPixModal] = useState<{open: boolean, invoice: any, item: any}>({ open: false, invoice: null, item: null });

  // Cart State
  const [cart, setCart] = useState<{ item: any, quantity: number }[]>([]);
  const [cartModalOpen, setCartModalOpen] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const checkoutOpIdRef = useRef<string | null>(null);

  const isTrackedProduct = (item: any) => item.type === "product" && item.trackStock === true;
  const isOutOfStock = (item: any) => isTrackedProduct(item) && item.stockQuantity !== null && item.stockQuantity <= 0;

  const addToCart = (item: any) => {
    if (isOutOfStock(item)) {
      toast({ title: "Item esgotado", variant: "destructive" });
      return;
    }
    checkoutOpIdRef.current = null;
    setCart(prev => {
      const existing = prev.find(i => i.item.id === item.id);
      if (existing) {
        if (isTrackedProduct(item) && item.stockQuantity !== null && existing.quantity >= item.stockQuantity) {
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
    checkoutOpIdRef.current = null;
    setCart(prev => prev.filter(i => i.item.id !== itemId));
  };

  const updateQuantity = (itemId: number, delta: number) => {
    checkoutOpIdRef.current = null;
    setCart(prev => prev.map(i => {
      if (i.item.id === itemId) {
        const newQ = i.quantity + delta;
        if (newQ < 1) return i;
        if (isTrackedProduct(i.item) && i.item.stockQuantity !== null && newQ > i.item.stockQuantity) {
          toast({ title: "Estoque insuficiente", variant: "destructive" });
          return i;
        }
        return { ...i, quantity: newQ };
      }
      return i;
    }));
  };

  const cartSubtotal = cart.reduce((acc, curr) => acc + (curr.item.basePrice * curr.quantity), 0);

  // Only apply delivery fee when there are physical product items in the cart
  const cartHasPhysicalItems = cart.some(c => c.item.type !== 'service');
  const deliveryFee = cartHasPhysicalItems && deliveryMethod === 'delivery' && creche?.deliveryType === 'fixed' ? Number(creche?.deliveryFee || 0) : 0;
  const cartTotal = cartSubtotal + deliveryFee;

  const handleCheckout = () => {
    if (cartHasPhysicalItems && deliveryMethod === 'delivery' && !deliveryAddress.trim()) {
      toast({ title: "Atenção", description: "Por favor informe o endereço de entrega.", variant: "destructive" });
      return;
    }

    if (!checkoutOpIdRef.current) {
      checkoutOpIdRef.current = crypto.randomUUID();
    }
    const currentOpId = checkoutOpIdRef.current;

    createOrderMutation.mutate({
      operationId: currentOpId,
      items: cart.map(c => ({ catalogueItemId: c.item.id, quantity: c.quantity })),
      deliveryMethod: cartHasPhysicalItems ? deliveryMethod : 'pickup',
      deliveryAddress: deliveryAddress.trim() || null,
      deliveryFee
    }, {
      onSuccess: (data) => {
        setCart([]);
        checkoutOpIdRef.current = null;
        setCartModalOpen(false);
        setPixModal({ open: true, invoice: data.invoice, item: { name: "Seu Pedido", creditsAmount: 0 } });
      },
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando loja...</div>;

  const activeItems = catalogue?.filter((item: any) => item.isActive) || [];
  const serviceItems = activeItems.filter((item: any) => item.type === 'service');
  const productItems = activeItems.filter((item: any) => item.type !== 'service');

  const renderServiceCard = (item: any) => (
    <Card key={item.id} className="overflow-hidden group border-border hover:border-primary/50 transition-colors flex flex-col bg-card">
      <CardContent className="p-0 flex flex-col flex-1">
        <div className="h-48 bg-secondary/50 relative flex items-center justify-center overflow-hidden">
          <StoreImage
            src={item.mediaUrls && item.mediaUrls.length > 0 ? buildMediaSrc(item.mediaUrls[0], mediaToken) : null}
            alt={item.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            fallback={<Sparkles className="h-16 w-16 text-muted-foreground group-hover:scale-110 transition-transform duration-500" />}
          />
          <div className="absolute top-4 right-4 flex flex-col gap-1 items-end">
            <Badge variant="secondary" className="uppercase text-[10px] tracking-wider">
              {item.category || 'Serviço'}
            </Badge>
            <Badge variant="outline" className="bg-background text-foreground uppercase text-[10px] tracking-wider flex items-center gap-1 shadow-sm">
              <Sparkles className="h-2.5 w-2.5 text-primary" /> Vira crédito
            </Badge>
          </div>
        </div>
        <div className="p-6 flex flex-col flex-1 space-y-4">
          <div>
            <h3 className="text-xl font-bold text-foreground mb-1 leading-tight">{item.name}</h3>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {item.description || "Sem descrição."}
            </p>
          </div>

          <div className="mt-auto pt-4 border-t border-border">
            <p className="text-2xl font-display font-bold text-foreground">
              {formatCentsToBRL(item.basePrice)}
            </p>
            {item.creditsAmount && (
              <p className="text-xs text-primary mt-1 font-medium">
                Gera {item.creditsAmount} crédito{item.creditsAmount !== 1 ? 's' : ''} para usar em reservas
              </p>
            )}
          </div>

          <Button
            className="w-full h-11 bg-primary text-primary-foreground shadow-sm"
            onClick={() => addToCart(item)}
          >
            <ShoppingCart className="mr-2 h-4 w-4" /> Adicionar ao Carrinho
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const renderProductCard = (item: any) => (
    <Card key={item.id} className="overflow-hidden group border-border hover:border-primary/50 transition-colors flex flex-col bg-card">
      <CardContent className="p-0 flex flex-col flex-1">
        <div className="h-48 bg-secondary/50 relative flex items-center justify-center overflow-hidden">
          <StoreImage
            src={item.mediaUrls && item.mediaUrls.length > 0 ? buildMediaSrc(item.mediaUrls[0], mediaToken) : null}
            alt={item.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            fallback={<PackageOpen className="h-16 w-16 text-muted-foreground group-hover:scale-110 transition-transform duration-500" />}
          />
          <div className="absolute top-4 right-4">
            <Badge variant="secondary" className="uppercase text-[10px] tracking-wider">
              {item.type === 'package' ? 'Pacote' : item.category || item.type}
            </Badge>
          </div>
        </div>
        <div className="p-6 flex flex-col flex-1 space-y-4">
          <div>
            <h3 className="text-xl font-bold text-foreground mb-1 leading-tight">{item.name}</h3>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {item.description || "Sem descrição."}
            </p>
          </div>

          <div className="mt-auto pt-4 border-t border-border">
            <p className="text-2xl font-display font-bold text-foreground">
              {formatCentsToBRL(item.basePrice)}
            </p>

            {item.type === 'package' && item.creditsAmount && (
              <p className="text-xs text-muted-foreground mt-1">Inclui {item.creditsAmount} diárias</p>
            )}

            {isTrackedProduct(item) && item.stockQuantity !== null && (
              <p className="text-xs text-muted-foreground mt-1">
                Estoque: <span className={item.stockQuantity === 0 ? "text-destructive font-bold" : "text-primary font-bold"}>{item.stockQuantity} un.</span>
              </p>
            )}
          </div>

          <Button
            className="w-full h-11 shadow-sm"
            variant="default"
            disabled={isOutOfStock(item)}
            onClick={() => addToCart(item)}
          >
            <ShoppingCart className="mr-2 h-4 w-4" /> {isOutOfStock(item) ? 'Esgotado' : 'Adicionar ao Carrinho'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const isEmpty = activeItems.length === 0;

  // Service items in cart (for credit summary)
  const cartServiceItems = cart.filter(c => c.item.type === 'service');

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto pb-24">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground tracking-tight">Lojinha</h1>
          <p className="text-muted-foreground mt-1">Compre produtos, serviços e pacotes de diárias.</p>
        </div>
        {cart.length > 0 && (
          <Button onClick={() => setCartModalOpen(true)} className="relative bg-primary hover:bg-primary/90 text-primary-foreground rounded-full p-4 h-14 w-14">
            <ShoppingBag className="h-6 w-6" />
            <span className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center border-2 border-background">
              {cart.reduce((a, b) => a + b.quantity, 0)}
            </span>
          </Button>
        )}
      </div>

      {isEmpty ? (
        <div className="p-12 text-center border border-border rounded-2xl bg-card">
          <PackageOpen className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-4" />
          <h3 className="text-lg font-medium text-foreground">Nenhum item disponível</h3>
          <p className="text-muted-foreground mt-1">A creche não possui itens à venda no momento.</p>
        </div>
      ) : (
        <>
          {/* Services Section */}
          {serviceItems.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-primary" />
                <div>
                  <h2 className="text-xl font-bold text-foreground">Serviços Pré-pagos</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ao comprar, você recebe créditos que podem ser usados na próxima reserva. Nenhum produto físico é enviado.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {serviceItems.map((item: any) => renderServiceCard(item))}
              </div>
            </section>
          )}

          {/* Products Section */}
          {productItems.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <PackageOpen className="h-5 w-5 text-primary" />
                <div>
                  <h2 className="text-xl font-bold text-foreground">Produtos</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Produtos físicos e pacotes de diárias disponíveis para compra.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {productItems.map((item: any) => renderProductCard(item))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Cart Modal */}
      {cartModalOpen && (
        <Modal isOpen={true} onClose={() => setCartModalOpen(false)} title="Seu Carrinho" className="max-w-md w-full mx-4 sm:mx-auto">
          <div className="space-y-6">
            <div className="max-h-[50vh] overflow-y-auto space-y-4 pr-2">
              {cart.map((cartItem) => (
                <div key={cartItem.item.id} className="flex gap-4 items-center bg-card p-3 rounded-xl border border-border shadow-sm">
                  <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center overflow-hidden shrink-0 border border-border">
                    <StoreImage
                      src={cartItem.item.mediaUrls?.[0] ? buildMediaSrc(cartItem.item.mediaUrls[0], mediaToken) : null}
                      alt={cartItem.item.name}
                      className="w-full h-full object-cover"
                      fallback={
                        cartItem.item.type === 'service' ? (
                          <Sparkles className="h-6 w-6 text-muted-foreground" />
                        ) : (
                          <PackageOpen className="h-6 w-6 text-muted-foreground" />
                        )
                      }
                    />
                  </div>
                  <div className="flex-1 min-w-0 py-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <p className="font-semibold text-foreground text-sm leading-tight break-words">{cartItem.item.name}</p>
                      {cartItem.item.type === 'service' && (
                        <Badge variant="secondary" className="shrink-0 text-[9px] px-1.5 py-0">Crédito</Badge>
                      )}
                    </div>
                    <p className="font-bold text-sm text-foreground">
                      {formatCentsToBRL(cartItem.item.basePrice)}
                    </p>
                    {cartItem.item.type === 'service' && (
                      <p className="text-[11px] text-muted-foreground mt-1 leading-tight">
                        Receba {cartItem.item.creditsAmount ? cartItem.item.creditsAmount * cartItem.quantity : cartItem.quantity} crédito{(cartItem.item.creditsAmount ? cartItem.item.creditsAmount * cartItem.quantity : cartItem.quantity) !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                    <Button variant="outline" size="icon" className="h-11 w-11 rounded-full shrink-0" onClick={() => updateQuantity(cartItem.item.id, -1)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="text-foreground text-sm font-medium w-6 text-center">{cartItem.quantity}</span>
                    <Button variant="outline" size="icon" className="h-11 w-11 rounded-full shrink-0" onClick={() => updateQuantity(cartItem.item.id, 1)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground hover:text-destructive shrink-0" onClick={() => removeFromCart(cartItem.item.id)}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="border-t border-border pt-4 space-y-5">
              {/* Delivery section only for physical items */}
              {cartHasPhysicalItems && (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground">Método de Entrega</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`p-3 text-sm rounded-lg border transition-colors flex items-center justify-center font-medium h-12 ${deliveryMethod === 'pickup' ? 'bg-primary/10 border-primary text-primary' : 'bg-card border-border text-muted-foreground hover:bg-secondary'}`}
                      onClick={() => { checkoutOpIdRef.current = null; setDeliveryMethod('pickup'); }}
                    >
                      Retirar na Creche
                    </button>
                    <button
                      className={`p-3 text-sm rounded-lg border transition-colors flex items-center justify-center font-medium h-12 ${deliveryMethod === 'delivery' ? 'bg-primary/10 border-primary text-primary' : 'bg-card border-border text-muted-foreground hover:bg-secondary'}`}
                      onClick={() => { checkoutOpIdRef.current = null; setDeliveryMethod('delivery'); }}
                    >
                      Receber em Casa
                    </button>
                  </div>

                  {deliveryMethod === 'delivery' && (
                    <div className="space-y-2 animate-in slide-in-from-top-2 pt-1">
                      <label className="text-sm font-medium text-foreground">Endereço de Entrega Completo</label>
                      <Input
                        placeholder="Rua, Número, Bairro, CEP"
                        value={deliveryAddress}
                        onChange={(e) => { checkoutOpIdRef.current = null; setDeliveryAddress(e.target.value); }}
                        className="text-base h-12"
                      />
                      {creche?.deliveryType === 'on_demand' && (
                        <p className="text-xs text-warning mt-1">O valor do frete será cobrado separadamente após combinarmos a entrega com você.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Service credits summary */}
              {cartServiceItems.length > 0 && (
                <div className="rounded-lg bg-secondary/50 border border-border p-4 space-y-1.5">
                  <p className="text-xs font-medium text-foreground flex items-center gap-1.5 mb-2">
                    <Sparkles className="h-4 w-4 text-primary" /> Créditos que você vai receber
                  </p>
                  {cartServiceItems.map(c => (
                    <p key={c.item.id} className="text-xs text-muted-foreground pl-5.5">
                      • {c.item.creditsAmount ? c.item.creditsAmount * c.quantity : c.quantity} crédito{(c.item.creditsAmount ? c.item.creditsAmount * c.quantity : c.quantity) !== 1 ? 's' : ''} de <span className="text-foreground font-medium">{c.item.name}</span>
                    </p>
                  ))}
                  <p className="text-[11px] text-muted-foreground pl-5.5 pt-1.5">
                    Os créditos serão liberados após confirmação do pagamento.
                  </p>
                </div>
              )}

              <div className="space-y-2.5 text-sm pt-2">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatCentsToBRL(cartSubtotal)}</span>
                </div>
                {cartHasPhysicalItems && deliveryMethod === 'delivery' && creche?.deliveryType === 'fixed' && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Taxa de Entrega</span>
                    <span>{formatCentsToBRL(deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between text-foreground font-bold text-lg pt-3 border-t border-border">
                  <span>Total a Pagar</span>
                  <span className="text-primary">{formatCentsToBRL(cartTotal)}</span>
                </div>
              </div>

              <Button
                className="w-full h-12 text-base font-semibold"
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
          <div className="space-y-5 py-2">
            <div className="rounded-xl bg-warning/10 border border-warning/20 p-4">
              <p className="text-sm font-semibold text-warning flex items-center gap-2">
                ⏳ Seu pedido será processado após o pagamento
              </p>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Envie o comprovante na aba Financeiro para liberarmos os créditos e/ou a entrega.
              </p>
            </div>

            <div className="space-y-3 bg-card border border-border rounded-xl p-4">
              <p className="text-sm font-bold text-foreground">Próximos passos:</p>
              <ol className="text-sm text-muted-foreground space-y-3 list-decimal list-inside marker:font-bold marker:text-foreground">
                <li>Realize o Pix no valor de <strong className="text-foreground">{formatCentsToBRL(pixModal.invoice?.amount || 0)}</strong></li>
                <li>Acesse a aba <strong className="text-foreground">"Meu Financeiro"</strong></li>
                <li>Localize a fatura <strong className="text-foreground">#{pixModal.invoice?.id}</strong> e anexe o comprovante</li>
                <li>A creche fará a aprovação e você será notificado</li>
              </ol>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-3 justify-end pt-4 border-t border-border mt-6">
              <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => setPixModal({ open: false, invoice: null, item: null })}>
                Continuar Comprando
              </Button>
              <Button className="h-11 w-full sm:w-auto" onClick={() => { setPixModal({ open: false, invoice: null, item: null }); navigate('/tutor/financial'); }}>
                Ir para Meu Financeiro
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
