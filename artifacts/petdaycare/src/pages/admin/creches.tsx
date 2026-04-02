import React, { useState } from "react";
import { useListCreches, useCreateCreche } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Building2, Plus, MapPin, Phone, Users, Mail } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

export default function AdminCreches() {
  const queryClient = useQueryClient();
  const { data: creches, isLoading } = useListCreches();
  const createMutation = useCreateCreche();
  const [isOpen, setIsOpen] = useState(false);

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate(
      {
        data: {
          name: fd.get("name") as string,
          address: fd.get("address") as string,
          phone: fd.get("phone") as string,
          email: fd.get("email") as string,
          maxCapacity: Number(fd.get("maxCapacity")) || 20,
          adminEmail: fd.get("adminEmail") as string || undefined,
          adminName: fd.get("adminName") as string || undefined,
          adminPassword: fd.get("adminPassword") as string || undefined,
        } as any,
      },
      {
        onSuccess: () => {
          setIsOpen(false);
          queryClient.invalidateQueries();
        },
      }
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-display font-bold text-white">Creches</h1>
          <p className="text-muted-foreground mt-1">Gerencie todas as unidades da rede LuxePets.</p>
        </div>
        <Button onClick={() => setIsOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nova Creche
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Total</p>
            <p className="text-3xl font-display font-bold text-white">{creches?.length || 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Ativas</p>
            <p className="text-3xl font-display font-bold text-emerald-400">
              {creches?.filter((c) => c.status === "active").length || 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground mb-1">Inativas</p>
            <p className="text-3xl font-display font-bold text-muted-foreground">
              {creches?.filter((c) => c.status === "inactive").length || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {isLoading ? (
          <div className="col-span-3 p-8 text-center text-muted-foreground">Carregando...</div>
        ) : creches?.length ? (
          creches.map((creche) => (
            <Card key={creche.id} className={`relative overflow-hidden transition-all hover:border-primary/30 ${creche.status === "inactive" ? "opacity-60" : ""}`}>
              <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full" />
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-primary" />
                  </div>
                  <Badge variant={creche.status === "active" ? "success" : "secondary"}>
                    {creche.status === "active" ? "Ativa" : "Inativa"}
                  </Badge>
                </div>
                <h3 className="text-xl font-display font-semibold text-white mb-3">{creche.name}</h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  {creche.address && (
                    <p className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0" /> {creche.address}
                    </p>
                  )}
                  {creche.phone && (
                    <p className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 flex-shrink-0" /> {creche.phone}
                    </p>
                  )}
                  <p className="flex items-center gap-2">
                    <Users className="h-3.5 w-3.5 flex-shrink-0" />
                    Capacidade: {creche.currentOccupancy}/{creche.maxCapacity}
                  </p>
                </div>
                <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center">
                  <p className="text-xs text-muted-foreground">
                    Criada em {format(new Date(creche.createdAt), "dd/MM/yyyy")}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-3">
            <EmptyState
              icon={Building2}
              title="Nenhuma creche cadastrada"
              description="Crie a primeira unidade da rede LuxePets."
              action={{ label: "Criar Creche", onClick: () => setIsOpen(true) }}
            />
          </div>
        )}
      </div>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Cadastrar Nova Creche">
        <form onSubmit={handleCreate} className="space-y-4">
          <p className="text-sm text-muted-foreground pb-2 border-b border-white/10">Dados da Unidade</p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome da Creche</label>
            <Input name="name" required placeholder="Pet Paradise São Paulo" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Endereço
            </label>
            <Input name="address" required placeholder="Rua das Flores, 123 — São Paulo/SP" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" /> Telefone
              </label>
              <Input name="phone" required placeholder="(11) 99999-9999" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" /> Email
              </label>
              <Input name="email" type="email" required placeholder="creche@luxepets.com.br" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Capacidade Máxima
            </label>
            <Input name="maxCapacity" type="number" min={1} max={500} defaultValue={20} />
          </div>

          <p className="text-sm text-muted-foreground pt-2 pb-1 border-b border-white/10">Admin da Creche (opcional)</p>
          <p className="text-xs text-muted-foreground">Crie o administrador da creche agora. A senha provisória será definida e o usuário deverá alterá-la no primeiro acesso.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome do Admin</label>
              <Input name="adminName" placeholder="Ana Costa" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email do Admin</label>
              <Input name="adminEmail" type="email" placeholder="ana@luxepets.com.br" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Senha Provisória</label>
            <Input name="adminPassword" type="password" placeholder="Mín. 6 caracteres" />
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              <Building2 className="mr-2 h-4 w-4" /> Criar Creche
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
