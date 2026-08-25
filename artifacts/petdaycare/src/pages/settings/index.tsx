import React, { useState } from "react";
import {
  useGetCreche,
  useUpdateCreche,
  getGetCrecheQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { usePush } from "@/hooks/use-push";
import { useTheme } from "@/components/theme-provider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, MapPin, Phone, Globe, Save, Users, Bell, BellOff, BellRing, ShieldCheck, LogOut, UserCircle, Settings as SettingsIcon, PackageOpen, CircleDollarSign, Smartphone, Sun, Moon, Palette } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn, uploadFileDirect } from "@/lib/utils";
import { parseReaisInputToCents } from "@/lib/money";

function isIos() {
  return typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isInStandaloneMode() {
  return typeof navigator !== "undefined" && "standalone" in navigator && (navigator as any).standalone === true;
}

export default function Settings() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const crecheId = user?.role === "master_admin" ? null : (user?.crecheId ?? null);
  const queryClient = useQueryClient();
  const { data: creche, isLoading } = useGetCreche(crecheId ?? 0);
  const updateMutation = useUpdateCreche();
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { isSupported, isIosWithoutPwa, permission, isSubscribed, isLoading: pushLoading, subscribe, unsubscribe } = usePush();

  const { toast } = useToast();

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!crecheId) return;
    const file = e.target.files?.[0];
    if (!file) return;
    const token = localStorage.getItem("auth_token");
    if (!token) return;

    setUploadingLogo(true);
    try {
      const objectPath = await uploadFileDirect(file, token);
      updateMutation.mutate({
        crecheId,
        data: { logoUrl: `/api/storage/public-objects/${objectPath.replace(/^\/+/, "")}` }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCrecheQueryKey(crecheId) });
          queryClient.invalidateQueries({ queryKey: ["creche", crecheId] });
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        }
      });
    } catch (err: any) {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    } finally {
      setUploadingLogo(false);
    }
  };


  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!crecheId) return;
    const formData = new FormData(e.currentTarget);

    const rawDeliveryFee = (formData.get("deliveryFee") as string || "").trim();
    let deliveryFeeCents = 0;
    if (rawDeliveryFee !== "") {
      const parsed = parseReaisInputToCents(rawDeliveryFee);
      if (parsed === null || parsed < 0) {
        toast({ title: "Erro", description: "Taxa de frete monetária inválida.", variant: "destructive" });
        return;
      }
      deliveryFeeCents = parsed;
    }

    updateMutation.mutate(
      {
        crecheId,
        data: {
          name: formData.get("name") as string,
          address: formData.get("address") as string,
          phone: formData.get("phone") as string,
          maxCapacity: Number(formData.get("maxCapacity")),
          deliveryType: formData.get("deliveryType") as "fixed" | "on_demand",
          deliveryFee: deliveryFeeCents.toString(),
          pixKey: formData.get("pixKey") as string,
          pixName: formData.get("pixName") as string,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCrecheQueryKey(crecheId) });
          queryClient.invalidateQueries({ queryKey: ["creche", crecheId] });
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
      }
    );
  };

  if (isLoading && !!crecheId) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 lg:space-y-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Configurações"
        description="Gerencie o perfil da creche e suas preferências."
        icon={SettingsIcon}
      />


      {/* Creche Info */}
      {user?.role !== "tutor" && user?.role !== "master_admin" && !!crecheId && (
        <Card className="rounded-2xl shadow-sm overflow-hidden">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {creche?.logoUrl ? (
                    <img src={creche.logoUrl} alt="Logo da Creche" className="h-full w-full object-cover" />
                  ) : (
                    <Building2 className="h-5 w-5 text-primary" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-display font-semibold text-foreground">Dados da Creche</h2>
                  {user?.role === "staff" && (
                    <p className="text-xs font-medium text-muted-foreground">Apenas visualização</p>
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
                    className="min-h-[44px] px-4 rounded-xl text-sm font-medium"
                  >
                    Alterar Logo
                  </Button>
                </div>
              )}
            </div>

            {user?.role === "staff" ? (
              <div className="space-y-1 text-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-border/40 gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 className="h-4 w-4" />
                    <p className="text-xs font-medium">Nome</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground break-words min-w-0">{creche?.name || "—"}</p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-border/40 gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <p className="text-xs font-medium">Endereço</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground break-words min-w-0">{creche?.address || "—"}</p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-border/40 gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <p className="text-xs font-medium">Telefone</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground break-words min-w-0">{creche?.phone || "—"}</p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-border/40 gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <p className="text-xs font-medium">Capacidade</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground break-words min-w-0">{creche?.maxCapacity || "—"} pets</p>
                </div>
                
                {/* Loja / Delivery */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-border/40 gap-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <PackageOpen className="h-4 w-4" />
                    <p className="text-xs font-medium">Tipo de Frete</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground break-words min-w-0">{creche?.deliveryType === 'on_demand' ? "Sob Consulta" : "Taxa Fixa"}</p>
                </div>
                {creche?.deliveryType === 'fixed' && (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-1">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CircleDollarSign className="h-4 w-4" />
                      <p className="text-xs font-medium">Taxa de Frete</p>
                    </div>
                    <p className="text-sm font-semibold text-foreground break-words min-w-0">R$ {(Number(creche?.deliveryFee || 0) / 100).toFixed(2).replace('.', ',')}</p>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Section: Dados Gerais */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" /> Dados Gerais
                  </h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Nome da Creche</label>
                      <Input name="name" defaultValue={creche?.name || ""} required className="h-12 sm:h-10 rounded-xl text-[16px] sm:text-sm" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Endereço Completo</label>
                      <Input name="address" defaultValue={creche?.address || ""} placeholder="Rua das Flores, 123 - São Paulo" className="h-12 sm:h-10 rounded-xl text-[16px] sm:text-sm" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Telefone</label>
                        <Input name="phone" defaultValue={creche?.phone || ""} placeholder="(11) 99999-9999" className="h-12 sm:h-10 rounded-xl text-[16px] sm:text-sm" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Capacidade Máxima</label>
                        <Input name="maxCapacity" type="number" min={1} max={200} defaultValue={creche?.maxCapacity || 15} className="h-12 sm:h-10 rounded-xl text-[16px] sm:text-sm" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section: Entrega */}
                <div className="space-y-4 pt-6 border-t border-border/50">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <PackageOpen className="h-4 w-4 text-primary" /> Loja & Entrega
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Tipo de Frete</label>
                      <select 
                        name="deliveryType" 
                        defaultValue={creche?.deliveryType || "fixed"} 
                        className="flex h-12 sm:h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-[16px] sm:text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <option value="fixed">Taxa Fixa</option>
                        <option value="on_demand">Sob Consulta</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Valor da Taxa (R$)</label>
                      <Input name="deliveryFee" type="number" step="0.01" min={0} defaultValue={((Number(creche?.deliveryFee) || 0) / 100).toFixed(2)} className="h-12 sm:h-10 rounded-xl text-[16px] sm:text-sm" />
                    </div>
                  </div>
                </div>

                {/* Section: PIX */}
                <div className="space-y-4 pt-6 border-t border-border/50">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <CircleDollarSign className="h-4 w-4 text-primary" /> Recebimento (PIX)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Chave Pix</label>
                      <Input name="pixKey" defaultValue={creche?.pixKey || ""} placeholder="CPF, CNPJ, Email ou Celular" className="h-12 sm:h-10 rounded-xl text-[16px] sm:text-sm min-w-0 w-full" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Nome do Favorecido</label>
                      <Input name="pixName" defaultValue={creche?.pixName || ""} placeholder="Nome registrado na conta" className="h-12 sm:h-10 rounded-xl text-[16px] sm:text-sm min-w-0 w-full" />
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-6 mt-6 flex flex-col sm:flex-row items-center gap-4 border-t border-border/50">
                  <Button type="submit" isLoading={updateMutation.isPending} className="w-full sm:w-auto h-12 sm:h-10 rounded-xl px-8 font-medium">
                    <Save className="mr-2 h-4 w-4" /> Salvar Alterações
                  </Button>
                  {saved && (
                    <p className="text-sm font-medium text-success flex items-center justify-center gap-1.5 py-2">
                      <ShieldCheck className="h-4 w-4" /> Salvo com sucesso
                    </p>
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* Push Notifications */}
      <Card className="rounded-2xl shadow-sm overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-5 pb-4 border-b border-border">
            <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
              <Bell className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-display font-semibold text-foreground">Notificações</h2>
              <p className="text-xs text-muted-foreground">Alertas em tempo real neste dispositivo</p>
            </div>
          </div>

          {/* iOS without PWA — show install guide */}
          {isIosWithoutPwa ? (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
              <div className="flex items-center gap-2.5">
                <Smartphone className="h-5 w-5 text-primary flex-shrink-0" />
                <p className="text-sm font-semibold text-foreground">Instale o app para ativar</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                O iOS exige que o app esteja instalado na tela inicial para receber notificações push. Siga os passos:
              </p>
              <ol className="space-y-2.5 text-xs text-muted-foreground">
                <li className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px] mt-0.5 flex-shrink-0">1</span>
                  <span className="pt-0.5">Abra este site no <span className="text-foreground font-medium">Safari</span> (não funciona em Chrome/Firefox no iOS).</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px] mt-0.5 flex-shrink-0">2</span>
                  <span className="pt-0.5">Toque no ícone <span className="text-foreground font-medium">Compartilhar</span> (□↑) na barra inferior.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px] mt-0.5 flex-shrink-0">3</span>
                  <span className="pt-0.5">Selecione <span className="text-foreground font-medium">"Adicionar à Tela de Início"</span>.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px] mt-0.5 flex-shrink-0">4</span>
                  <span className="pt-0.5">Abra o app instalado e ative as notificações aqui.</span>
                </li>
              </ol>
            </div>
          ) : !isSupported ? (
            /* Browser doesn't support push */
            <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary border border-border">
              <BellOff className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <p className="text-sm text-muted-foreground">Seu navegador não suporta notificações push.</p>
            </div>
          ) : permission === "denied" ? (
            /* User blocked notifications in browser */
            <div className="rounded-xl border border-warning/20 bg-warning/10 p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <BellOff className="h-5 w-5 text-warning flex-shrink-0" />
                <p className="text-sm font-semibold text-foreground">Notificações bloqueadas</p>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Você bloqueou as notificações neste navegador. Para reativar: acesse as configurações do navegador → Privacidade → Notificações → encontre este site e mude para <span className="text-foreground font-medium">"Permitir"</span>.
              </p>
            </div>
          ) : isSubscribed ? (
            /* Active — show deactivate option */
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl border border-success/20 bg-success/5">
              <div className="flex items-center gap-3.5">
                <div className="h-10 w-10 rounded-xl bg-success/20 flex items-center justify-center flex-shrink-0">
                  <BellRing className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Notificações ativas</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Você está recebendo alertas neste dispositivo.</p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={unsubscribe}
                isLoading={pushLoading}
                className="flex-shrink-0 min-h-[44px] sm:min-h-10 rounded-xl w-full sm:w-auto text-destructive border-destructive/20 hover:bg-destructive/10 hover:text-destructive"
              >
                <BellOff className="h-4 w-4 mr-2" /> Desativar
              </Button>
            </div>
          ) : (
            /* Not subscribed — show activate option */
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl border border-border bg-secondary/30">
              <div className="flex items-center gap-3.5">
                <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                  <BellOff className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Notificações inativas</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Ative para receber alertas em tempo real.</p>
                </div>
              </div>
              <Button
                onClick={subscribe}
                isLoading={pushLoading}
                className="flex-shrink-0 min-h-[44px] sm:min-h-10 rounded-xl w-full sm:w-auto"
              >
                <Bell className="h-4 w-4 mr-2" /> Ativar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Aparência (Theme Control) */}
      <Card className="rounded-2xl shadow-sm overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-5 pb-4 border-b border-border">
            <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
              <Palette className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-display font-semibold text-foreground">Aparência</h2>
              <p className="text-xs text-muted-foreground">Personalize o tema da interface</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setTheme("light")}
              aria-pressed={theme === "light"}
              className={cn(
                "flex items-center justify-center gap-2.5 rounded-xl border p-3 text-sm font-medium transition-colors min-h-[44px]",
                theme === "light" 
                  ? "border-primary bg-primary/5 text-primary" 
                  : "border-border bg-background text-muted-foreground hover:bg-secondary/50"
              )}
            >
              <Sun className="h-4 w-4" />
              Claro
            </button>
            <button
              type="button"
              onClick={() => setTheme("dark")}
              aria-pressed={theme === "dark"}
              className={cn(
                "flex items-center justify-center gap-2.5 rounded-xl border p-3 text-sm font-medium transition-colors min-h-[44px]",
                theme === "dark" 
                  ? "border-primary bg-primary/5 text-primary" 
                  : "border-border bg-background text-muted-foreground hover:bg-secondary/50"
              )}
            >
              <Moon className="h-4 w-4" />
              Escuro
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Account Info */}
      <Card className="rounded-2xl shadow-sm overflow-hidden">
        <CardContent className="p-0">
          <div className="p-6 pb-2">
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-border">
              <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0">
                <UserCircle className="h-5 w-5 text-foreground" />
              </div>
              <h2 className="text-lg font-display font-semibold text-foreground">Minha Conta</h2>
            </div>
            
            <div className="space-y-1 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-border/40 gap-1">
                <p className="text-xs font-medium text-muted-foreground">Nome</p>
                <p className="text-sm font-semibold text-foreground">{user?.name}</p>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-border/40 gap-1">
                <p className="text-xs font-medium text-muted-foreground">Email</p>
                <p className="text-sm font-semibold text-foreground truncate min-w-0">{user?.email}</p>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 border-b border-border/40 gap-1">
                <p className="text-xs font-medium text-muted-foreground">Perfil</p>
                <p className="text-sm font-semibold text-foreground capitalize">
                  {({ master_admin: "Master Admin", creche_admin: "Admin de Creche", staff: "Funcionário", tutor: "Tutor" } as Record<string, string>)[user?.role || ""] || user?.role}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-1">
                <p className="text-xs font-medium text-muted-foreground">Creche vinculada</p>
                <p className="text-sm font-semibold text-foreground">{user?.crecheId ? `#${user.crecheId}` : "Global (Master)"}</p>
              </div>
            </div>
          </div>

          <div className="bg-secondary/30 p-6 space-y-3 border-t border-border/50">
            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border border-border bg-background text-foreground hover:bg-secondary font-medium text-sm transition-all active:scale-[0.98] min-h-[44px]"
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
                className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl border border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/20 font-medium text-sm transition-all active:scale-[0.98] min-h-[44px]"
              >
                <ShieldCheck className="h-4 w-4" />
                Excluir Meus Dados (LGPD)
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground pb-4">Versão v31</p>
    </div>
  );
}
