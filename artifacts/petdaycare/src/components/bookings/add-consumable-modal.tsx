import React, { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Package, Plus, Trash2, Receipt } from "lucide-react";
import { 
  useListCatalogue, 
  useAddBookingConsumable,
  useBookingConsumables,
  useDeleteBookingConsumable
} from "@/hooks/use-financial";
import { useToast } from "@/hooks/use-toast";

interface AddConsumableModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookingId: number;
  crecheId: number;
  petName: string;
}

export function AddConsumableModal({ isOpen, onClose, bookingId, crecheId, petName }: AddConsumableModalProps) {
  const [search, setSearch] = useState("");
  const { data: catalogue, isLoading } = useListCatalogue(crecheId);
  const { data: launchedItems, isLoading: isLaunchedLoading } = useBookingConsumables(crecheId, bookingId);
  const addMutation = useAddBookingConsumable(crecheId);
  const deleteMutation = useDeleteBookingConsumable(crecheId);
  const { toast } = useToast();

  const filtered = catalogue?.filter((item: any) => 
    item.type === "service" || item.type === "product"
  ).filter((item: any) => 
    item.name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleAdd = (item: any) => {
    addMutation.mutate({
      bookingId,
      catalogueItemId: item.id,
      quantity: 1,
      chargedPrice: item.price
    }, {
      onSuccess: () => {
        toast({ title: "Adicionado com sucesso", description: `${item.name} foi adicionado à reserva de ${petName}.` });
        // Does not close modal to allow multiple additions
      },
      onError: (err: any) => {
        toast({ title: "Erro ao adicionar", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleDelete = (consumableId: number) => {
    deleteMutation.mutate({
      bookingId,
      consumableId
    }, {
      onSuccess: () => {
        toast({ title: "Removido com sucesso", description: "O consumo foi removido da reserva." });
      },
      onError: (err: any) => {
        toast({ title: "Erro ao remover", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Lançar Consumo: ${petName}`}>
      <div className="space-y-6">
        
        {/* Lançamentos Atuais */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Receipt className="h-4 w-4 text-success" />
            Consumos Registrados
          </h4>
          
          {isLaunchedLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground bg-secondary rounded-xl border border-border">Carregando consumos...</div>
          ) : !launchedItems || launchedItems.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground bg-secondary rounded-xl border border-border">
              Nenhum consumo registrado ainda.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto custom-scrollbar pr-2 space-y-2">
              {launchedItems.map((consumable: any) => (
                <div key={consumable.id} className="flex items-center justify-between p-3 rounded-lg border border-success/20 bg-success/10">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{consumable.item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(consumable.chargedPrice) / 100)}
                      </p>
                    </div>
                  </div>
                  <Button 
                    size="default" 
                    variant="ghost"
                    onClick={() => handleDelete(consumable.id)}
                    disabled={deleteMutation.isPending}
                    className="h-10 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-border w-full" />

        {/* Adicionar Novo */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Plus className="h-4 w-4 text-primary" />
            Adicionar Novo Consumo
          </h4>
          <Input
            icon={<Search className="h-4 w-4" />}
            placeholder="Buscar serviço ou produto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-secondary border-border text-foreground"
          />
          
          <div className="max-h-60 overflow-y-auto custom-scrollbar pr-2 space-y-2">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Carregando catálogo...</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">Nenhum item encontrado.</div>
            ) : (
              filtered.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-secondary hover:bg-secondary/80 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <Package className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(item.price) / 100)}
                      </p>
                    </div>
                  </div>
                  <Button 
                    size="default" 
                    variant="outline"
                    onClick={() => handleAdd(item)}
                    disabled={addMutation.isPending}
                    className="h-10"
                  >
                    <Plus className="h-4 w-4 sm:mr-1" />
                    <span className="hidden sm:inline">Lançar</span>
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
        
        <div className="pt-4 border-t border-border flex justify-end">
          <Button onClick={onClose} className="w-full sm:w-auto">
            Concluir Lançamentos
          </Button>
        </div>
      </div>
    </Modal>
  );
}
