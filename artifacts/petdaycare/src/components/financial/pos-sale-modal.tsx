import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Package, Plus, Trash2, ShoppingCart, AlertCircle } from "lucide-react";
import { useListCatalogue, usePosSale } from "@/hooks/use-financial";
import { useToast } from "@/hooks/use-toast";

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
    <Modal isOpen={isOpen} onClose={onClose} title="Venda Balcão (PDV)">
      <div className="space-y-6">
        
        {/* Adicionar Novo */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <Search className="h-4 w-4 text-blue-400" />
            Buscar Produto/Serviço (Leitor USB)
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
            className="bg-white/5 border-white/10 text-white"
          />
          
          {search && (
            <div className="max-h-60 overflow-y-auto custom-scrollbar pr-2 space-y-2 border border-white/10 rounded-lg p-2 bg-black/20">
              {isLoading ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Carregando catálogo...</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">Nenhum item encontrado.</div>
              ) : (
                filtered.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <Package className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{item.name}</p>
                        <p className="text-xs text-muted-foreground flex gap-2">
                          <span>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(item.price) / 100)}</span>
                          {item.type === 'product' && (
                            <span className={item.stockQuantity > 0 ? "text-emerald-400" : "text-destructive"}>
                              (Estoque: {item.stockQuantity})
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <Button 
                      size="sm" 
                      variant="outline"
                      onClick={() => handleAdd(item)}
                      disabled={item.type === 'product' && item.stockQuantity <= 0}
                      className="h-8"
                    >
                      <Plus className="h-4 w-4 sm:mr-1" />
                      <span className="hidden sm:inline">Adicionar</span>
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="h-px bg-white/10 w-full" />

        {/* Lançamentos Atuais */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-emerald-400" />
            Carrinho
          </h4>
          
          {cart.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground bg-white/5 rounded-xl border border-white/5">
              Carrinho vazio.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto custom-scrollbar pr-2 space-y-2">
              {cartWithStockStatus.map((c) => (
                <div key={c.item.id} className={`flex flex-col p-3 rounded-lg border ${c.isOutOfStock ? 'border-destructive/50 bg-destructive/10' : 'border-emerald-500/20 bg-emerald-500/5'}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{c.item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(c.item.price) / 100)} unit.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleQuantityChange(c.item.id, c.quantity - 1)}
                        disabled={c.quantity <= 1}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-white"
                      >
                        <span className="text-base leading-none">−</span>
                      </Button>
                      <span className="w-8 text-center text-sm font-semibold text-white tabular-nums">
                        {c.quantity}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleQuantityChange(c.item.id, c.quantity + 1)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-white"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => handleRemove(c.item.id)}
                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive ml-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {c.isOutOfStock && (
                    <div className="mt-2 text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3" />
                      Estoque insuficiente (Saldo: {c.item.stockQuantity || 0})
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-white/10 space-y-4">
          <div className="flex justify-between items-center text-lg font-bold text-white">
            <span>Total:</span>
            <span className="text-emerald-400">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total / 100)}</span>
          </div>
          
          <div>
            <label className="text-sm mb-1 block">Forma de Pagamento</label>
            <select 
              className="w-full bg-white/5 border border-white/10 rounded-md h-10 px-3 text-sm"
              value={paymentMethod} 
              onChange={e => setPaymentMethod(e.target.value)}
            >
              <option value="cash" className="bg-zinc-900">Dinheiro</option>
              <option value="pix" className="bg-zinc-900">PIX</option>
              <option value="credit_card" className="bg-zinc-900">Cartão de Crédito</option>
              <option value="debit_card" className="bg-zinc-900">Cartão de Débito</option>
              <option value="pending" className="bg-zinc-900">Fiado / Pendente</option>
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button 
              onClick={handleFinish} 
              disabled={cart.length === 0 || hasStockError || posSaleMutation.isPending} 
              isLoading={posSaleMutation.isPending}
            >
              Finalizar Venda
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
