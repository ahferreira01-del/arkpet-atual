import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Package, Plus, Trash2, ShoppingCart, AlertCircle } from "lucide-react";
import { useListCatalogue, usePosSale } from "@/hooks/use-financial";
import { useToast } from "@/hooks/use-toast";
import { formatCentsToBRL } from "@/lib/money";

interface POSSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  crecheId: number;
}

export function POSSaleModal({ isOpen, onClose, crecheId }: POSSaleModalProps) {
  const [search, setSearch] = useState("");
  const { data: catalogue, isLoading } = useListCatalogue(crecheId);
  const posSaleMutation = usePosSale(crecheId);
  const { toast } = useToast();

  const [cart, setCart] = useState<{ item: any, quantity: number }[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");

  const filtered = catalogue?.filter((item: any) => 
    item.type === "service" || item.type === "product" || item.type === "day_use"
  ).filter((item: any) => 
    item.name.toLowerCase().includes(search.toLowerCase()) || 
    (item.barcode && item.barcode.includes(search))
  ) || [];

  const handleAdd = (item: any) => {
    setCart(prev => {
      const existing = prev.find(i => i.item.id === item.id);
      if (existing) {
        return prev.map(i => i.item.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { item, quantity: 1 }];
    });
    setSearch(""); // Limpa o campo para o próximo bipe
  };

  const handleRemove = (itemId: number) => {
    setCart(prev => prev.filter(i => i.item.id !== itemId));
  };

  const handleQuantityChange = (itemId: number, newQuantity: number) => {
    if (newQuantity < 1) return;
    setCart(prev => prev.map(i => i.item.id === itemId ? { ...i, quantity: newQuantity } : i));
  };

  const total = cart.reduce((acc, current) => acc + (current.item.price * current.quantity), 0);

  // Validação de estoque SEM LOCK
  // Só aplica para produtos com trackStock=true. Serviços e day_use nunca têm estoque.
  const cartWithStockStatus = cart.map(cartItem => {
    const isOutOfStock =
      cartItem.item.type === 'product' &&
      cartItem.item.trackStock === true &&
      cartItem.quantity > (cartItem.item.stockQuantity || 0);
    return { ...cartItem, isOutOfStock };
  });

  const hasStockError = cartWithStockStatus.some(c => c.isOutOfStock);

  const handleFinish = () => {
    if (cart.length === 0) {
      toast({ title: "Erro", description: "O carrinho está vazio.", variant: "destructive" });
      return;
    }

    if (hasStockError) {
      toast({ title: "Erro de Estoque", description: "Existem itens no carrinho com quantidade indisponível.", variant: "destructive" });
      return;
    }

    const payload = {
      items: cart.map(c => ({
        catalogueItemId: c.item.id,
        quantity: c.quantity
      })),
      paymentMethod
    };

    posSaleMutation.mutate(payload, {
      onSuccess: () => {
        toast({ title: "Venda Concluída", description: "Venda finalizada com sucesso." });
        setCart([]);
        setPaymentMethod("cash");
        onClose();
      },
      onError: (err: any) => {
        toast({ title: "Erro na venda", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Venda Balcão (PDV)" className="md:!max-w-5xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-2">
        
        {/* ESQUERDA: CATÁLOGO */}
        <div className="space-y-4 flex flex-col h-full lg:max-h-[60vh]">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            Catálogo (Leitor USB)
          </h4>
          <Input
            icon={<Search className="h-4 w-4" />}
            placeholder="Digite o nome ou bipe o código de barras..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                // Se der enter e tiver 1 resultado exato, adiciona direto
                if (filtered.length === 1) {
                  handleAdd(filtered[0]);
                }
              }
            }}
            autoFocus
            className="bg-background border-input text-foreground"
          />
          
          <div className="flex-1 min-h-[250px] overflow-y-auto custom-scrollbar space-y-2 pr-2">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Carregando catálogo...</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                <Package className="h-8 w-8 opacity-20" />
                <span>Nenhum item encontrado.</span>
              </div>
            ) : (
              filtered.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between p-3 rounded-2xl border border-border bg-card hover:border-primary/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Package className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground line-clamp-1">{item.name}</p>
                      <p className="text-xs text-muted-foreground flex gap-2 mt-0.5">
                        <span className="font-semibold">{formatCentsToBRL(Number(item.price) )}</span>
                        {item.type === 'product' && (
                          <span className={item.stockQuantity > 0 ? "text-success font-medium" : "text-destructive font-bold"}>
                            (Estoque: {item.stockQuantity})
                          </span>
                        )}
                        {item.type !== 'product' && (
                          <span className="text-primary/70 uppercase text-[10px] tracking-wider bg-primary/10 px-1 rounded">
                            {item.type === 'day_use' ? 'Day Use' : 'Serviço'}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <Button 
                    size="sm" 
                    variant="secondary"
                    onClick={() => handleAdd(item)}
                    disabled={item.type === 'product' && item.stockQuantity <= 0}
                    className="h-9 shrink-0 ml-2"
                  >
                    <Plus className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Adicionar</span>
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* DIREITA: CARRINHO E CHECKOUT */}
        <div className="space-y-4 flex flex-col h-full lg:max-h-[60vh] bg-muted/30 p-4 rounded-2xl border border-border/50">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            Carrinho Atual
          </h4>
          
          <div className="flex-1 min-h-[200px] overflow-y-auto custom-scrollbar space-y-2 pr-2">
            {cart.length === 0 ? (
              <div className="h-full min-h-[150px] flex flex-col items-center justify-center p-8 text-center text-muted-foreground border border-dashed border-border rounded-2xl bg-background/50">
                <ShoppingCart className="h-8 w-8 opacity-20 mb-2" />
                <span className="text-sm">Carrinho vazio.</span>
              </div>
            ) : (
              cartWithStockStatus.map((c) => (
                <div key={c.item.id} className={`flex flex-col p-3 rounded-2xl border transition-colors ${c.isOutOfStock ? 'border-destructive/50 bg-destructive/10' : 'border-border bg-card'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{c.item.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatCentsToBRL(Number(c.item.price) )} / un.
                      </p>
                    </div>
                    
                    <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 border border-border/50">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleQuantityChange(c.item.id, c.quantity - 1)}
                        disabled={c.quantity <= 1}
                        className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground"
                      >
                        <span className="text-xl leading-none">−</span>
                      </Button>
                      <span className="w-8 text-center text-base font-bold text-foreground tabular-nums">
                        {c.quantity}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleQuantityChange(c.item.id, c.quantity + 1)}
                        className="h-11 w-11 p-0 text-muted-foreground hover:text-foreground"
                      >
                        <Plus className="h-5 w-5" />
                      </Button>
                    </div>
                    
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={() => handleRemove(c.item.id)}
                      className="h-11 w-11 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive ml-1 shrink-0 rounded-lg"
                    >
                      <Trash2 className="h-5 w-5" />
                    </Button>
                  </div>
                  {c.isOutOfStock && (
                    <div className="mt-2 text-xs font-medium text-destructive flex items-center gap-1.5 w-fit px-2 py-1 bg-destructive/10 rounded-md">
                      <AlertCircle className="h-3.5 w-3.5" />
                      Estoque insuficiente (Saldo atual: {c.item.stockQuantity || 0})
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="pt-4 border-t border-border space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-foreground">Forma de Pagamento</label>
              <select 
                className="w-full bg-background border border-input rounded-xl h-11 px-3 text-sm text-foreground focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                value={paymentMethod} 
                onChange={e => setPaymentMethod(e.target.value)}
              >
                <option value="cash" className="bg-background">Dinheiro</option>
                <option value="pix" className="bg-background">PIX</option>
                <option value="credit_card" className="bg-background">Cartão de Crédito</option>
                <option value="debit_card" className="bg-background">Cartão de Débito</option>
                <option value="pending" className="bg-background">Fiado / Pendente</option>
              </select>
            </div>

            <div className="flex justify-between items-end pb-2">
              <span className="text-sm font-medium text-muted-foreground">Total a pagar</span>
              <span className="text-3xl font-bold text-foreground tracking-tight">{formatCentsToBRL(total )}</span>
            </div>
            
            <div className="flex flex-col sm:flex-row justify-end gap-3 pt-2">
              <Button variant="outline" size="lg" onClick={onClose} className="w-full sm:w-auto h-12 rounded-xl">Cancelar</Button>
              <Button 
                size="lg"
                className="w-full sm:w-auto h-12 rounded-xl font-bold"
                onClick={handleFinish} 
                disabled={cart.length === 0 || hasStockError || posSaleMutation.isPending} 
                isLoading={posSaleMutation.isPending}
              >
                Finalizar Venda
              </Button>
            </div>
          </div>
        </div>
        
      </div>
    </Modal>
  );
}
