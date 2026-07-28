import React, { useState } from "react";
import { useGetCreche, useUpdateCreche } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { usePush } from "@/hooks/use-push";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, MapPin, Phone, Globe, Save, Users, Bell, BellOff, BellRing, ShieldCheck, LogOut, UserCircle, Settings as SettingsIcon, PackageOpen, CircleDollarSign } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn, uploadFileDirect } from "@/lib/utils";

export default function Settings() {
  const { user, logout } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();
  const { data: creche, isLoading } = useGetCreche(crecheId);
  const updateMutation = useUpdateCreche();
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { toast } = useToast();

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const token = localStorage.getItem("auth_token");
    if (!token) return;

    setUploadingLogo(true);
    try {
      const objectPath = await uploadFileDirect(file, token);
      updateMutation.mutate({
        crecheId,
        data: { logoUrl: `/api/storage/public-objects/${objectPath}` }
      }, {
        onSuccess: () => queryClient.invalidateQueries()
      });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setUploadingLogo(false);
    }
  };


  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    updateMutation.mutate(
      {
        crecheId,
        data: {
          name: formData.get("name") as string,
          address: formData.get("address") as string,
          phone: formData.get("phone") as string,
          maxCapacity: Number(formData.get("maxCapacity")),
          deliveryType: formData.get("deliveryType") as "fixed" | "on_demand",
          deliveryFee: (Number(formData.get("deliveryFee")) * 100).toString(),
          pixKey: formData.get("pixKey") as string,
          pixName: formData.get("pixName") as string,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
      }
    );
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl">
      <PageHeader
        title="Configurações"
        description="Gerencie o perfil da creche e suas preferências."
        icon={SettingsIcon}
      />


      {/* Creche Info */}
      {user?.role !== "tutor" && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center overflow-hidden">
                  {creche?.logoUrl ? (
                    <img src={creche.logoUrl} alt="Logo da Creche" className="h-full w-full object-cover" />
                  ) : (
                    <Building2 className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-display font-semibold text-white">Dados da Creche</h2>
                  {user?.role === "staff" && (
                    <p className="text-xs text-muted-foreground">Apenas visualização</p>
                  )}
                </div>
              </div>
              
              {user?.role !== "staff" && (
                <div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleLogoUpload}
                    accept="image/*"
                    className="hidden"
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={() => fileInputRef.current?.click()}
                    isLoading={uploadingLogo}
                  >
                    Alterar Logo
                  </Button>
                </div>
              )}
            </div>

            {user?.role === "staff" ? (
              <div className="space-y-5 text-sm">
                <div className="flex items-start gap-3 py-3 border-b border-white/5">
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Nome</p>
                    <p className="font-medium text-white">{creche?.name || "—"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 py-3 border-b border-white/5">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Endereço</p>
                    <p className="font-medium text-white">{creche?.address || "—"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3 py-3">
                    <Phone className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Telefone</p>
                      <p className="font-medium text-white">{creche?.phone || "—"}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 py-3">
                    <Users className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Capacidade</p>
                      <p className="font-medium text-white">{creche?.maxCapacity || "—"} pets</p>
                    </div>
                  </div>
                </div>
                
                {/* Loja / Delivery */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3 py-3">
                    <PackageOpen className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Tipo de Frete</p>
                      <p className="font-medium text-white">{creche?.deliveryType === 'on_demand' ? "Sob Consulta" : "Taxa Fixa"}</p>
                    </div>
                  </div>
                  {creche?.deliveryType === 'fixed' && (
                    <div className="flex items-start gap-3 py-3">
                      <CircleDollarSign className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-muted-foreground text-xs mb-0.5">Taxa de Frete</p>
                        <p className="font-medium text-white">R$ {(Number(creche?.deliveryFee || 0) / 100).toFixed(2).replace('.', ',')}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" /> Nome
                  </label>
                  <Input name="name" defaultValue={creche?.name || ""} required />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" /> Endereço
                  </label>
                  <Input name="address" defaultValue={creche?.address || ""} placeholder="Rua das Flores, 123 - São Paulo" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" /> Telefone
                    </label>
                    <Input name="phone" defaultValue={creche?.phone || ""} placeholder="(11) 99999-9999" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Users className="h-4 w-4 text-muted-foreground" /> Capacidade
                    </label>
                    <Input name="maxCapacity" type="number" min={1} max={200} defaultValue={creche?.maxCapacity || 15} />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <PackageOpen className="h-4 w-4 text-muted-foreground" /> Tipo de Frete (Loja)
                    </label>
                    <select name="deliveryType" defaultValue={creche?.deliveryType || "fixed"} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                      <option value="fixed">Taxa Fixa</option>
                      <option value="on_demand">Sob Consulta</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <CircleDollarSign className="h-4 w-4 text-muted-foreground" /> Valor da Taxa (R$)
                    </label>
                    <Input name="deliveryFee" type="number" step="0.01" min={0} defaultValue={((Number(creche?.deliveryFee) || 0) / 100).toFixed(2)} />
                  </div>
                </div>

                <div className="pt-4 pb-2 border-t border-white/10 mt-6">
                  <h3 className="text-sm font-semibold text-white mb-4">Configurações de Recebimento (Pix)</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-muted-foreground">Chave Pix</label>
                      <Input name="pixKey" defaultValue={creche?.pixKey || ""} placeholder="CPF, CNPJ, Email ou Celular" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-muted-foreground">Nome do Favorecido</label>
                      <Input name="pixName" defaultValue={creche?.pixName || ""} placeholder="Nome registrado na conta" />
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-4">
                  <Button type="submit" isLoading={updateMutation.isPending}>
                    <Save className="mr-2 h-4 w-4" /> Salvar Alterações
                  </Button>
                  {saved && (
                    <p className="text-sm text-emerald-400 flex items-center gap-1">
                      <ShieldCheck className="h-4 w-4" /> Salvo com sucesso
                    </p>
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* Account Info */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
            <div className="h-10 w-10 rounded-xl bg-white/5 flex items-center justify-center">
              <UserCircle className="h-5 w-5 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-display font-semibold text-white">Minha Conta</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm mb-6">
            <div>
              <p className="text-muted-foreground mb-1">Nome</p>
              <p className="font-medium text-white">{user?.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Email</p>
              <p className="font-medium text-white truncate">{user?.email}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Perfil</p>
              <p className="font-medium text-white capitalize">
                {({ master_admin: "Master Admin", creche_admin: "Admin de Creche", staff: "Funcionário", tutor: "Tutor" } as Record<string, string>)[user?.role || ""] || user?.role}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Creche</p>
              <p className="font-medium text-white">#{crecheId}</p>
            </div>
          </div>

          {/* Logout button — prominent on mobile */}
          <div className="pt-4 border-t border-white/10 space-y-3">
            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border border-white/10 bg-white/5 text-white hover:bg-white/10 font-medium text-sm transition-all duration-200 active:scale-[0.98]"
            >
              <LogOut className="h-4 w-4" />
              Sair da conta
            </button>
            
            {user?.role === "tutor" && (
              <button
                onClick={async () => {
                  if (confirm("⚠️ TEM CERTEZA? Esta ação é irreversível. Seus dados pessoais serão apagados e seu acesso será permanentemente revogado. Suas faturas pagas continuarão nos registros da creche.")) {
                    try {
                      const token = localStorage.getItem("auth_token");
                      const res = await fetch(`/api/users/${user.id}/anonymize`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${token}` }
                      });
                      if (!res.ok) {
                        const errorData = await res.json().catch(() => ({}));
                        throw new Error(errorData.error || "Erro ao excluir conta");
                      }
                      logout();
                    } catch (err: any) {
                      toast({ title: "Erro ao excluir conta", description: err.message, variant: "destructive" });
                    }
                  }
                }}
                className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 font-medium text-sm transition-all duration-200 active:scale-[0.98]"
              >
                <ShieldCheck className="h-4 w-4" />
                Excluir Meus Dados (LGPD)
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
