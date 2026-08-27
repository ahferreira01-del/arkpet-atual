import * as React from "react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AdvancedDataTable } from "@/components/ui/advanced-data-table";
import { Plus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useListExpenses, useCreateExpense, useUpdateExpense, useDeleteExpense, usePayExpense } from "@/hooks/use-financial";
import { useToast } from "@/hooks/use-toast";
import { formatCentsToBRL, parseReaisInputToCents } from "@/lib/money";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function PayablesTab({ crecheId }: { crecheId: number }) {
  const { data: expenses, isLoading } = useListExpenses(crecheId);
  const createMutation = useCreateExpense(crecheId);
  const updateMutation = useUpdateExpense(crecheId);
  const deleteMutation = useDeleteExpense(crecheId);
  const payMutation = usePayExpense(crecheId);
  const { toast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ description: "", category: "operacional", amount: "", dueDate: "" });

  const openEditModal = (exp: any) => {
    setEditingId(exp.id);
    setForm({
      description: exp.description,
      category: exp.category,
      amount: (exp.amount / 100).toString(),
      dueDate: new Date(exp.dueDate || exp.date || new Date()).toISOString().split('T')[0]
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.description || !form.category || !form.amount || !form.dueDate) {
      toast({ title: "Erro", description: "Preencha todos os campos obrigatórios.", variant: "destructive" });
      return;
    }
    const rawAmount = form.amount.trim();
    if (rawAmount === "") {
      toast({ title: "Erro", description: "O valor é obrigatório.", variant: "destructive" });
      return;
    }
    const amountCents = parseReaisInputToCents(rawAmount);
    if (amountCents === null || amountCents < 0) {
      toast({ title: "Erro", description: "O valor deve ser um formato monetário válido e positivo.", variant: "destructive" });
      return;
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, ...form, amount: amountCents }, {
        onSuccess: () => {
          toast({ title: "Sucesso", description: "Despesa atualizada com sucesso." });
          setModalOpen(false);
          setEditingId(null);
          setForm({ description: "", category: "operacional", amount: "", dueDate: "" });
        },
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    } else {
      createMutation.mutate({ ...form, amount: amountCents }, {
        onSuccess: () => {
          toast({ title: "Sucesso", description: "Despesa registrada." });
          setModalOpen(false);
          setForm({ description: "", category: "operacional", amount: "", dueDate: "" });
        },
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Tem certeza que deseja excluir esta despesa?")) {
      deleteMutation.mutate(id, {
        onSuccess: () => toast({ title: "Sucesso", description: "Despesa excluída com sucesso." }),
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
      });
    }
  };

  const handlePay = (id: number) => {
    payMutation.mutate(id, {
      onSuccess: () => toast({ title: "Sucesso", description: "Despesa paga e baixada no fluxo de caixa." }),
      onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" })
    });
  };



  const columns = React.useMemo(() => [
    { accessorKey: "description", header: "Descrição", cell: (info: any) => <span className="font-medium text-foreground">{info.getValue()}</span> },
    { accessorKey: "category", header: "Categoria", cell: (info: any) => <Badge variant="outline" className="capitalize font-normal text-muted-foreground">{info.getValue()}</Badge> },
    { accessorKey: "dueDate", header: "Vencimento", cell: (info: any) => {
        const d = info.getValue() || info.row.original.date || new Date();
        return <span className="text-muted-foreground">{format(new Date(d), "dd/MM/yyyy", { locale: ptBR })}</span>;
    } },
    { accessorKey: "amount", header: () => <div className="text-right">Valor</div>, meta: { exportValue: (v: any) => formatCentsToBRL(Number(v)) }, cell: (info: any) => <div className="text-right font-semibold text-destructive">-{formatCentsToBRL(info.getValue())}</div> },
    { accessorKey: "isPaid", header: "Status", cell: (info: any) => {
        return info.getValue()
          ? <Badge variant="success">Pago</Badge>
          : <Badge variant="secondary" className="text-muted-foreground">Pendente</Badge>;
    } },
    {
      id: "actions",
      header: () => <div className="text-right">Ações</div>,
      cell: ({ row }: any) => {
        const exp = row.original;
        return (
          <div className="flex justify-end gap-1">
            {!exp.isPaid && (
              <>
                <Button size="sm" onClick={() => handlePay(exp.id)} isLoading={payMutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground h-8">
                  Pagar
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Mais opções da despesa" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => openEditModal(exp)}>
                      <Pencil className="mr-2 h-4 w-4" /> Editar
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleDelete(exp.id)} disabled={deleteMutation.isPending} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" /> Excluir
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        );
      }
    }
  ], [payMutation.isPending, deleteMutation.isPending]);

  const renderMobileCard = React.useCallback((row: any) => {
    const exp = row.original;
    const d = exp.dueDate || exp.date || new Date();
    const dueDateStr = format(new Date(d), "dd/MM/yyyy", { locale: ptBR });

    return (
      <div className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-4 shadow-sm relative overflow-hidden">
        <div className="flex justify-between items-start gap-2">
          <div className="flex flex-col">
            <span className="font-semibold text-foreground leading-tight">{exp.description}</span>
            <span className="text-xs text-muted-foreground mt-0.5 capitalize">{exp.category}</span>
          </div>
          {exp.isPaid
            ? <Badge variant="success" className="shrink-0">Pago</Badge>
            : <Badge variant="secondary" className="text-muted-foreground shrink-0">Pendente</Badge>
          }
        </div>

        <div className="grid grid-cols-2 gap-2 bg-muted/30 p-3 rounded-xl border border-border">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Valor</span>
            <span className="text-sm font-bold text-destructive">-{formatCentsToBRL(exp.amount)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Vencimento</span>
            <span className="text-sm font-semibold text-foreground">{dueDateStr}</span>
          </div>
        </div>

        <div className="flex justify-end items-center gap-2 pt-1">
          {!exp.isPaid && (
            <>
              <Button size="sm" onClick={() => handlePay(exp.id)} isLoading={payMutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[100px] h-9">
                Pagar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Mais opções da despesa" className="h-9 w-9">
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => openEditModal(exp)}>
                    <Pencil className="mr-2 h-4 w-4" /> Editar Despesa
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleDelete(exp.id)} disabled={deleteMutation.isPending} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" /> Excluir Despesa
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>
    );
  }, [payMutation.isPending, deleteMutation.isPending]);

  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando despesas...</div>;

  return (
    <>
    <Card>
      <CardContent className="p-0">
        <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20">
          <h3 className="font-semibold text-foreground">Despesas Registradas</h3>
          <Button size="sm" onClick={() => {
            setEditingId(null);
            setForm({ description: "", category: "operacional", amount: "", dueDate: "" });
            setModalOpen(true);
          }} className="h-9">
            <Plus className="mr-2 h-4 w-4" /> Nova Despesa
          </Button>
        </div>
        <div className="p-4">
          <AdvancedDataTable
            columns={columns}
            data={expenses || []}
            searchKey="description"
            searchPlaceholder="Buscar despesa..."
            fileName="Despesas"
            renderMobileCard={renderMobileCard}
          />
        </div>
      </CardContent>
    </Card>

    {modalOpen && (
      <Modal isOpen={true} onClose={() => setModalOpen(false)} title={editingId ? "Editar Despesa" : "Nova Despesa"}>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Descrição <span className="text-destructive">*</span></label>
            <Input
              value={form.description}
              onChange={e => setForm({...form, description: e.target.value})}
              placeholder="Ex: Conta de Luz"
              className="h-11 sm:h-10 text-base sm:text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Categoria <span className="text-destructive">*</span></label>
            <Input
              value={form.category}
              onChange={e => setForm({...form, category: e.target.value})}
              placeholder="Ex: operacional"
              className="h-11 sm:h-10 text-base sm:text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Valor (R$) <span className="text-destructive">*</span></label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={e => setForm({...form, amount: e.target.value})}
                placeholder="Ex: 150.00"
                className="h-11 sm:h-10 text-base sm:text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Vencimento <span className="text-destructive">*</span></label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={e => setForm({...form, dueDate: e.target.value})}
                className="h-11 sm:h-10 text-base sm:text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setModalOpen(false)} className="h-11 sm:h-10 min-w-[120px] rounded-full">
              Cancelar
            </Button>
            <Button onClick={handleSave} isLoading={createMutation.isPending || updateMutation.isPending} className="h-11 sm:h-10 min-w-[150px] rounded-full bg-primary text-primary-foreground hover:bg-primary/90">
              {editingId ? "Salvar Alterações" : "Salvar Despesa"}
            </Button>
          </div>
        </div>
      </Modal>
    )}
    </>
  );
}
