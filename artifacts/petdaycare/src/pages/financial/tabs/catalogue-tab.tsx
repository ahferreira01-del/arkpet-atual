import React, { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import {
  Camera,
  ShieldAlert,
  PackageOpen,
  Plus,
  MoreHorizontal,
  Activity,
  Trash2
} from "lucide-react";
import {
  useListCatalogue,
  useCreateCatalogueItem,
  useUpdateCatalogueItem,
  useDeleteCatalogueItem,
  useStockTransactions,
  useStockAdjustment
} from "@/hooks/use-financial";
import { formatCentsToBRL, parseReaisInputToCents } from "@/lib/money";
import { buildMediaSrc, getMediaToken } from "@/features/feed/utils/media.utils";
import { uploadFileDirect } from "@/lib/utils";
import { CatalogueSmartIndicators } from "@/components/financial/smart-indicators";

function StockHistoryModal({ crecheId, itemId, itemName, onClose }: { crecheId: number; itemId: number; itemName: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useStockTransactions(crecheId, itemId, page, 20);
  const adjustMutation = useStockAdjustment(crecheId);
  const { toast } = useToast();

  const [adjDelta, setAdjDelta] = useState("");
  const [adjReason, setAdjReason] = useState("");

  const handleAdjust = () => {
    const delta = parseInt(adjDelta);
    if (!adjDelta || isNaN(delta) || delta === 0) {
      toast({ title: "Erro", description: "Informe um delta diferente de zero.", variant: "destructive" });
      return;
    }
    if (!adjReason.trim()) {
      toast({ title: "Erro", description: "Informe o motivo do ajuste.", variant: "destructive" });
      return;
    }
    adjustMutation.mutate({ itemId, delta, reason: adjReason.trim() }, {
      onSuccess: () => {
        toast({ title: "Sucesso", description: "Estoque ajustado com sucesso." });
        setAdjDelta("");
        setAdjReason("");
        setPage(1);
      },
      onError: (err: any) => {
        toast({ title: "Erro", description: err.message, variant: "destructive" });
      },
    });
  };

  const transactions = data?.data || [];
  const totalPages = data?.totalPages || 1;

  const typeLabel = (type: string) => {
    if (type === "in") return { label: "Entrada", color: "text-success bg-success/10" };
    if (type === "out") return { label: "Saída", color: "text-destructive bg-destructive/10" };
    return { label: "Ajuste", color: "text-warning bg-warning/10" };
  };

  const typeDelta = (type: string, qty: number) => {
    if (type === "in") return `+${qty}`;
    if (type === "out") return `-${qty}`;
    return `${qty}`;
  };

  return (
    <Modal isOpen={true} onClose={onClose} title={`Histórico de Estoque — ${itemName}`} className="max-w-2xl">
      <div className="space-y-6">

        {/* Inline adjustment form */}
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h4 className="text-sm font-semibold text-foreground mb-4">Ajustar Estoque</h4>
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-3 items-end">
            <div className="w-full sm:w-28">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Delta (+ / -)</label>
              <Input
                type="number"
                placeholder="ex: -3"
                value={adjDelta}
                onChange={e => setAdjDelta(e.target.value)}
                className="h-11 bg-background border-input text-foreground"
              />
            </div>
            <div className="w-full">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Motivo</label>
              <Input
                placeholder="ex: Quebra, recontagem..."
                value={adjReason}
                onChange={e => setAdjReason(e.target.value)}
                className="h-11 bg-background border-input text-foreground"
                onKeyDown={e => { if (e.key === "Enter") handleAdjust(); }}
              />
            </div>
            <Button
              onClick={handleAdjust}
              isLoading={adjustMutation.isPending}
              disabled={adjustMutation.isPending}
              className="h-11 w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Confirmar
            </Button>
          </div>
        </div>

        {/* Histórico */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-foreground">Movimentações</h4>

          {isLoading ? (
            <div className="text-center p-8 text-muted-foreground bg-muted/30 rounded-xl border border-border">Carregando histórico...</div>
          ) : transactions.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground bg-muted/30 rounded-xl border border-border">Nenhuma movimentação registrada.</div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden bg-card shadow-sm">
              <div className="hidden sm:grid grid-cols-5 gap-4 px-4 py-3 bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border">
                <span className="col-span-2">Data / Responsável</span>
                <span>Tipo</span>
                <span className="text-right">Delta</span>
                <span className="text-right">Motivo</span>
              </div>

              <div className="divide-y divide-border">
                {transactions.map((tx: any) => {
                  const { label, color } = typeLabel(tx.type);
                  return (
                    <div key={tx.id} className="flex flex-col sm:grid sm:grid-cols-5 gap-3 sm:gap-4 px-4 py-3.5 text-sm hover:bg-muted/30 transition-colors sm:items-center">
                      <div className="col-span-2 flex flex-col justify-center">
                        <p className="text-foreground font-medium">
                          {tx.createdAt ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(tx.createdAt)) : "—"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{tx.userName || "Sistema"}</p>
                      </div>

                      <div className="flex justify-between sm:contents items-center mt-2 sm:mt-0">
                        <span className="sm:hidden text-xs text-muted-foreground font-medium">Tipo:</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold w-fit ${color}`}>{label}</span>
                      </div>

                      <div className="flex justify-between sm:contents items-center mt-1 sm:mt-0">
                        <span className="sm:hidden text-xs text-muted-foreground font-medium">Delta:</span>
                        <span className={`sm:text-right font-bold text-base ${color.split(' ')[0]}`}>{typeDelta(tx.type, tx.quantity)}</span>
                      </div>

                      {tx.reason && (
                        <div className="flex flex-col sm:block mt-1 sm:mt-0">
                          <span className="sm:hidden text-xs text-muted-foreground font-medium mb-0.5">Motivo:</span>
                          <span className="sm:text-right text-muted-foreground text-sm line-clamp-2 sm:line-clamp-1 break-words" title={tx.reason}>{tx.reason}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Pagination & Close */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-2">
          {totalPages > 1 ? (
            <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
              <Button className="h-11 px-4" variant="outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                Anterior
              </Button>
              <span className="text-sm font-medium text-muted-foreground">Página {page} de {totalPages}</span>
              <Button className="h-11 px-4" variant="outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                Próxima
              </Button>
            </div>
          ) : (
            <div className="hidden sm:block"></div>
          )}

          <Button className="h-11 w-full sm:w-auto" variant="outline" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}


export function CatalogueTab({ crecheId }: { crecheId: number }) {
  const { data: catalogue, isLoading } = useListCatalogue(crecheId);
  const createMutation = useCreateCatalogueItem(crecheId);
  const updateMutation = useUpdateCatalogueItem(crecheId);
  const deleteMutation = useDeleteCatalogueItem(crecheId);
  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [historyItem, setHistoryItem] = useState<{ id: number; name: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: "",
    type: "product",
    description: "",
    price: "",
    stockQuantity: "",
    reorderThreshold: "",
    priceSmall: "",
    priceMedium: "",
    priceLarge: "",
    creditsAmount: "",
    maxPetsPerDay: "1",
    category: "",
    sku: "",
    barcode: "",
    costPrice: "",
    imageUrl: ""
  });

  const openEditModal = (item: any) => {
    setEditingId(item.id);
    setModalError(null);
    setForm({
      name: item.name,
      type: item.type,
      description: item.description || "",
      price: (item.basePrice / 100).toString(),
      stockQuantity: item.stockQuantity?.toString() || "",
      reorderThreshold: item.reorderThreshold != null ? item.reorderThreshold.toString() : "",
      priceSmall: item.pricingBySize?.small ? (item.pricingBySize.small / 100).toString() : "",
      priceMedium: item.pricingBySize?.medium ? (item.pricingBySize.medium / 100).toString() : "",
      priceLarge: item.pricingBySize?.large ? (item.pricingBySize.large / 100).toString() : "",
      creditsAmount: item.creditsAmount?.toString() || "",
      maxPetsPerDay: item.maxPetsPerDay?.toString() || "1",
      category: item.category || "",
      sku: item.sku || "",
      barcode: item.barcode || "",
      costPrice: item.costPrice ? (item.costPrice / 100).toString() : "",
      imageUrl: item.mediaUrls?.[0] || ""
    });
    setModalOpen(true);
  };

  const handleDelete = (id: number) => {
    if (confirm("Tem certeza que deseja excluir este item do catálogo?")) {
      deleteMutation.mutate(id, {
        onSuccess: () => toast({ title: "Sucesso", description: "Item excluído com sucesso", variant: "default" }),
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    }
  };

  const handleSave = () => {
    if (!form.name || !form.price) {
      toast({ title: "Erro", description: "Nome e preço são obrigatórios", variant: "destructive" });
      return;
    }
    const rawPrice = form.price.trim();
    if (rawPrice === "") {
      toast({ title: "Erro", description: "Preço é obrigatório.", variant: "destructive" });
      return;
    }
    const priceCents = parseReaisInputToCents(rawPrice);
    if (priceCents === null || priceCents < 0) {
      toast({ title: "Erro", description: "Preço não pode ser negativo e deve ser monetário válido.", variant: "destructive" });
      return;
    }

    let costPriceCents: number | null = null;
    if (form.type === "product") {
      const rawCostPrice = form.costPrice.trim();
      if (rawCostPrice !== "") {
        costPriceCents = parseReaisInputToCents(rawCostPrice);
        if (costPriceCents === null || costPriceCents < 0) {
          toast({ title: "Erro", description: "Preço de custo monetário inválido.", variant: "destructive" });
          return;
        }
      }
    }

    let priceSmallCents: number | null = null;
    let priceMediumCents: number | null = null;
    let priceLargeCents: number | null = null;
    if (form.type === "service" || form.type === "day_use") {
      const rawSmall = form.priceSmall.trim();
      if (rawSmall !== "") {
        priceSmallCents = parseReaisInputToCents(rawSmall);
        if (priceSmallCents === null || priceSmallCents < 0) {
          toast({ title: "Erro", description: "Preço pequeno monetário inválido.", variant: "destructive" });
          return;
        }
      }
      const rawMedium = form.priceMedium.trim();
      if (rawMedium !== "") {
        priceMediumCents = parseReaisInputToCents(rawMedium);
        if (priceMediumCents === null || priceMediumCents < 0) {
          toast({ title: "Erro", description: "Preço médio monetário inválido.", variant: "destructive" });
          return;
        }
      }
      const rawLarge = form.priceLarge.trim();
      if (rawLarge !== "") {
        priceLargeCents = parseReaisInputToCents(rawLarge);
        if (priceLargeCents === null || priceLargeCents < 0) {
          toast({ title: "Erro", description: "Preço grande monetário inválido.", variant: "destructive" });
          return;
        }
      }
    }
    if (form.type === "package" && (!form.creditsAmount || parseInt(form.creditsAmount) <= 0)) {
      toast({ title: "Erro", description: "Informe a quantidade de diárias (créditos) do pacote", variant: "destructive" });
      return;
    }

    const payload = {
      name: form.name,
      type: form.type,
      description: form.description,
      price: priceCents,
      stockQuantity: form.type === "product" && form.stockQuantity ? parseInt(form.stockQuantity) : null,
      reorderThreshold: form.type === "product" && form.reorderThreshold !== "" ? parseInt(form.reorderThreshold) : null,
      creditsAmount: form.type === "package" && form.creditsAmount ? parseInt(form.creditsAmount) : null,
      maxPetsPerDay: form.type === "package" && form.maxPetsPerDay ? parseInt(form.maxPetsPerDay) : 1,
      pricingBySize: (form.type === "service" || form.type === "day_use") ? {
        small: priceSmallCents !== null ? priceSmallCents : priceCents,
        medium: priceMediumCents !== null ? priceMediumCents : priceCents,
        large: priceLargeCents !== null ? priceLargeCents : priceCents,
      } : undefined,
      category: form.category || null,
      sku: form.sku || null,
      barcode: form.barcode || null,
      costPrice: costPriceCents,
      mediaUrls: form.imageUrl ? [form.imageUrl] : []
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload }, {
        onSuccess: () => {
          setModalOpen(false);
          setEditingId(null);
          setModalError(null);
          setForm({ name: "", type: "product", description: "", price: "", stockQuantity: "", reorderThreshold: "", priceSmall: "", priceMedium: "", priceLarge: "", creditsAmount: "", maxPetsPerDay: "1", category: "", sku: "", barcode: "", costPrice: "", imageUrl: "" });
          toast({ title: "Sucesso", description: "Item atualizado no catálogo", variant: "default" });
        },
        onError: (err: any) => {
          setModalError(err.message || "Erro ao atualizar item do catálogo");
        }
      });
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => {
          setModalOpen(false);
          setModalError(null);
          setForm({ name: "", type: "product", description: "", price: "", stockQuantity: "", reorderThreshold: "", priceSmall: "", priceMedium: "", priceLarge: "", creditsAmount: "", maxPetsPerDay: "1", category: "", sku: "", barcode: "", costPrice: "", imageUrl: "" });
          toast({ title: "Sucesso", description: "Item adicionado ao catálogo", variant: "default" });
        },
        onError: (err: any) => {
          setModalError(err.message || "Erro ao criar item do catálogo");
        }
      });
    }
  };


  const lowStockItems = (catalogue || []).filter((item: any) =>
    item.type === "product" &&
    item.stockQuantity !== null &&
    item.reorderThreshold != null &&
    item.stockQuantity <= item.reorderThreshold
  );

  if (isLoading) return <div className="text-center p-12 text-muted-foreground">Carregando catálogo...</div>;
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <h3 className="text-lg font-medium text-foreground">Catálogo</h3>
          {lowStockItems.length > 0 && (
            <Badge variant="destructive" className="flex items-center gap-1.5 font-semibold">
              <ShieldAlert className="w-3.5 h-3.5" />
              {lowStockItems.length} {lowStockItems.length === 1 ? "com estoque baixo" : "com estoque baixo"}
            </Badge>
          )}
        </div>
        <Button onClick={() => {
          setEditingId(null);
          setModalError(null);
          setForm({ name: "", type: "product", description: "", price: "", stockQuantity: "", reorderThreshold: "", priceSmall: "", priceMedium: "", priceLarge: "", creditsAmount: "", maxPetsPerDay: "1", category: "", sku: "", barcode: "", costPrice: "", imageUrl: "" });
          setModalOpen(true);
        }}>
          <Plus className="mr-2 h-4 w-4" /> Novo Item
        </Button>
      </div>

      {!catalogue || catalogue.length === 0 ? (
        <div className="text-center p-12 border border-dashed rounded-xl bg-muted/20">
          <PackageOpen className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-1">Nenhum item no catálogo</h3>
          <p className="text-muted-foreground">Adicione produtos e serviços para começar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {catalogue.map((item: any) => (
            <Card key={item.id} className="overflow-hidden group flex flex-col h-full bg-card shadow-sm border border-border">
              <div className="h-40 bg-muted relative flex items-center justify-center overflow-hidden shrink-0">
                {item.mediaUrls && item.mediaUrls.length > 0 ? (
                  <img src={buildMediaSrc(item.mediaUrls[0], getMediaToken())} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                ) : (
                  <PackageOpen className="h-10 w-10 text-muted-foreground opacity-30 group-hover:scale-110 transition-transform duration-300" />
                )}

                {item.type === "product" && item.stockQuantity !== null && item.reorderThreshold != null && item.stockQuantity <= item.reorderThreshold && (
                  <Badge variant="destructive" className="absolute top-2 right-2 shadow-sm font-bold">
                    Estoque Baixo
                  </Badge>
                )}
              </div>
              <CardContent className="p-4 flex-1 flex flex-col">
                <div className="flex justify-between items-start gap-2 mb-2">
                  <h4 className="font-semibold text-foreground leading-tight line-clamp-2">{item.name}</h4>
                  <Badge variant="outline" className="capitalize text-[10px] shrink-0 font-medium">
                    {item.type === 'package' ? 'Pacote' :
                     item.type === 'day_use' ? 'Day Use' :
                     item.type === 'service' ? 'Serviço' : 'Produto'}
                  </Badge>
                </div>

                <div className="mt-auto pt-2 space-y-1">
                  {(item.type === "service" || item.type === "day_use") && (item.pricingBySize?.small || item.pricingBySize?.medium || item.pricingBySize?.large) ? (
                    <p className="text-lg font-bold text-primary flex items-baseline gap-1">
                      <span className="text-xs font-medium text-muted-foreground">A partir de</span>
                      {formatCentsToBRL(
                        Math.min(
                          Number(item.price),
                          Number(item.pricingBySize?.small || item.price),
                          Number(item.pricingBySize?.medium || item.price),
                          Number(item.pricingBySize?.large || item.price)
                        )
                      )}
                    </p>
                  ) : (
                    <p className="text-lg font-bold text-primary">{formatCentsToBRL(item.price)}</p>
                  )}

                  {item.type === "product" && (
                    <p className="text-xs text-muted-foreground">
                      Em estoque: <strong className="text-foreground">{item.stockQuantity ?? 'Ilimitado'}</strong>
                    </p>
                  )}
                  {item.type === "package" && item.creditsAmount && (
                    <p className="text-xs text-muted-foreground">
                      <strong className="text-foreground">{item.creditsAmount} diárias</strong>
                      {item.maxPetsPerDay && item.maxPetsPerDay > 1 && (
                        <span className="ml-1 text-primary font-medium">(Até {item.maxPetsPerDay} pets/dia)</span>
                      )}
                    </p>
                  )}
                  {item.category && (
                    <p className="text-xs text-muted-foreground capitalize">
                      {item.category}
                    </p>
                  )}
                </div>

                <div className="pt-4 mt-4 border-t border-border flex items-center gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => openEditModal(item)}>
                    Editar
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" aria-label="Mais opções do item" className="px-2 w-9 h-9 shrink-0">
                        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      {item.type === "product" && (
                        <DropdownMenuItem onClick={() => setHistoryItem({ id: item.id, name: item.name })}>
                          <Activity className="h-4 w-4 mr-2" /> Histórico
                        </DropdownMenuItem>
                      )}
                      {item.type === "product" && <DropdownMenuSeparator />}
                      <DropdownMenuItem onClick={() => handleDelete(item.id)} className="text-destructive focus:text-destructive">
                        <Trash2 className="h-4 w-4 mr-2" /> Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {modalOpen && (
        <Modal isOpen={true} onClose={() => { setModalOpen(false); setModalError(null); }} title={editingId ? "Editar Item" : "Novo Item"} className="max-w-2xl">
          <div className="space-y-6">
            {editingId && (
              <CatalogueSmartIndicators crecheId={crecheId} itemId={editingId} type={form.type} />
            )}

            {modalError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive font-medium">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Nome <span className="text-destructive">*</span></label>
                <Input
                  value={form.name}
                  onChange={e => { setForm({...form, name: e.target.value}); setModalError(null); }}
                  placeholder="Ex: Ração Premium 10kg"
                  className="mt-1.5"
                />
                {!editingId && form.name.trim() && catalogue?.some((item: any) =>
                  item.name.trim().toLowerCase() === form.name.trim().toLowerCase()
                ) && (
                  <p className="mt-1.5 text-xs text-warning flex items-center gap-1 font-medium">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Já existe um item com este nome.
                  </p>
                )}
              </div>

              <div>
                <label className="text-sm font-medium">Tipo</label>
                <select
                  className="w-full bg-background border border-input rounded-md h-10 px-3 text-sm mt-1.5 text-foreground focus:ring-2 focus:ring-ring outline-none"
                  value={form.type}
                  onChange={e => setForm({...form, type: e.target.value})}
                >
                  <option value="product">Produto</option>
                  <option value="service">Serviço</option>
                  <option value="day_use">Day Use</option>
                  <option value="package">Pacote de Diárias</option>
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">Categoria</label>
                <Input value={form.category} onChange={e => setForm({...form, category: e.target.value})} placeholder="Ex: Rações, Banho" className="mt-1.5" />
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Preço Base (R$) <span className="text-destructive">*</span></label>
                <Input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({...form, price: e.target.value})} placeholder="0,00" className="mt-1.5 font-medium" />
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Descrição</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({...form, description: e.target.value})}
                  className="w-full bg-background border border-input rounded-md p-3 text-sm min-h-[80px] mt-1.5 resize-y focus:ring-2 focus:ring-ring outline-none"
                  placeholder="Detalhes opcionais do item..."
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Foto do Item</label>
                <input
                  ref={imageFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setImageUploading(true);
                    try {
                      const token = localStorage.getItem("auth_token") ?? "";
                      const objectPath = await uploadFileDirect(file, token);
                      setForm(f => ({ ...f, imageUrl: objectPath }));
                    } catch (err: any) {
                      toast({ title: "Erro no upload", description: err.message || "Não foi possível enviar a imagem.", variant: "destructive" });
                    } finally {
                      setImageUploading(false);
                      if (imageFileRef.current) imageFileRef.current.value = "";
                    }
                  }}
                />
                <div className="flex items-center gap-3 mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    disabled={imageUploading}
                    onClick={() => imageFileRef.current?.click()}
                  >
                    <Camera className="h-4 w-4" />
                    {imageUploading ? "Enviando…" : "Selecionar foto"}
                  </Button>
                  {form.imageUrl && (
                    <div className="flex items-center gap-2 flex-1 min-w-0 bg-muted/50 p-1.5 rounded-md border border-border">
                      <img
                        src={buildMediaSrc(form.imageUrl, getMediaToken())}
                        alt="preview"
                        className="h-8 w-8 rounded object-cover shrink-0"
                        onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <span className="text-xs text-muted-foreground truncate" title={form.imageUrl}>{form.imageUrl.split("/").pop()}</span>
                      <button
                        type="button"
                        className="text-xs text-destructive hover:text-destructive/80 shrink-0 font-medium ml-auto px-2"
                        onClick={() => setForm(f => ({ ...f, imageUrl: "" }))}
                      >
                        Remover
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {form.type === "product" && (
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground">Controle de Estoque</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Preço de Custo (R$)</label>
                    <Input type="number" min="0" step="0.01" value={form.costPrice} onChange={e => setForm({...form, costPrice: e.target.value})} placeholder="Opcional" className="mt-1.5" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Estoque (opcional)</label>
                    <Input type="number" min="0" value={form.stockQuantity} onChange={e => setForm({...form, stockQuantity: e.target.value})} placeholder="Quantidade atual" className="mt-1.5" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Ponto de Reposição</label>
                    <Input type="number" min="0" value={form.reorderThreshold} onChange={e => setForm({...form, reorderThreshold: e.target.value})} placeholder="Ex: 5" className="mt-1.5" />
                    <p className="text-[11px] text-muted-foreground mt-1">Alerte quando o estoque chegar aqui.</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Código de Barras</label>
                    <Input value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} placeholder="Ex: 7891000..." className="mt-1.5" />
                  </div>
                  <div>
                    <label className="text-sm font-medium">SKU (opcional)</label>
                    <Input value={form.sku} onChange={e => setForm({...form, sku: e.target.value})} placeholder="Código interno" className="mt-1.5" />
                  </div>
                </div>
              </div>
            )}

            {form.type === "package" && (
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground">Regras do Pacote</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Diárias (Créditos) <span className="text-destructive">*</span></label>
                    <Input type="number" min="1" value={form.creditsAmount} onChange={e => setForm({...form, creditsAmount: e.target.value})} placeholder="Ex: 20" className="mt-1.5" />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      O tutor receberá este número de diárias.
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Limite de Pets por Diária</label>
                    <Input type="number" min="1" value={form.maxPetsPerDay} onChange={e => setForm({...form, maxPetsPerDay: e.target.value})} placeholder="Ex: 1" className="mt-1.5" />
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Deixe 1 para pacotes normais.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {(form.type === "service" || form.type === "day_use") && (
              <div className="space-y-4 pt-4 border-t border-border">
                <h4 className="text-sm font-semibold text-foreground">Preços por Porte</h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-medium">Pequeno</label>
                    <Input type="number" min="0" step="0.01" value={form.priceSmall} onChange={e => setForm({...form, priceSmall: e.target.value})} placeholder="Padrão" className="mt-1 h-9 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Médio</label>
                    <Input type="number" min="0" step="0.01" value={form.priceMedium} onChange={e => setForm({...form, priceMedium: e.target.value})} placeholder="Padrão" className="mt-1 h-9 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Grande</label>
                    <Input type="number" min="0" step="0.01" value={form.priceLarge} onChange={e => setForm({...form, priceLarge: e.target.value})} placeholder="Padrão" className="mt-1 h-9 text-sm" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Se não informados, o porte usará o Preço Base do item.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t border-border">
              <Button variant="outline" onClick={() => { setModalOpen(false); setModalError(null); }} type="button">
                Cancelar
              </Button>
              <Button onClick={handleSave} isLoading={createMutation.isPending || updateMutation.isPending} className="min-w-[120px]">
                Salvar Item
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {historyItem && (
        <StockHistoryModal
          crecheId={crecheId}
          itemId={historyItem.id}
          itemName={historyItem.name}
          onClose={() => setHistoryItem(null)}
        />
      )}
    </div>
  );
}

