import React from "react";
import { useLocation } from "wouter";
import {
  useGetBillingPlans,
  useGetBillingSubscription,
  useCreateBillingCheckout,
  useCreateBillingPortal,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CreditCard, Check, Sparkles, Bell, ExternalLink, ShieldCheck, RefreshCw, Zap, CalendarClock, X, Dog, QrCode, FileText, Wrench, AlertTriangle, CheckCircle, Info, HardDrive, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ENTERPRISE_WHATSAPP_NUMBER = "551631870294";
const ENTERPRISE_WHATSAPP_MSG = "Ol%C3%A1%2C%20gostaria%20de%20saber%20mais%20sobre%20o%20plano%20Enterprise%20sob%20medida.";

type Interval = "month" | "quarter" | "semester" | "year";
type PaymentMode = "subscription" | "payment";

const INTERVALS: Interval[] = ["month", "quarter", "semester", "year"];

const INTERVAL_LABELS: Record<Interval, string> = {
  month: "Mensal",
  quarter: "Trimestral",
  semester: "Semestral",
  year: "Anual",
};

const INTERVAL_SUFFIX: Record<Interval, string> = {
  month: "/mês",
  quarter: "/trimestre",
  semester: "/semestre",
  year: "/ano",
};

const INTERVAL_MONTHS: Record<Interval, number> = {
  month: 1,
  quarter: 3,
  semester: 6,
  year: 12,
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  trial: { label: "Período de teste", className: "bg-primary/15 text-primary border-primary/25" },
  active: { label: "Ativa", className: "bg-success/15 text-success border-success/25" },
  past_due: { label: "Pagamento pendente", className: "bg-warning/15 text-warning border-warning/25" },
  suspended: { label: "Suspensa", className: "bg-destructive/15 text-destructive border-destructive/25" },
  cancelled: { label: "Cancelada", className: "bg-secondary text-muted-foreground border-border" },
};

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function formatStorageBytes(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return "—";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return `${val.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })} ${sizes[i]}`;
}

export default function Billing() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const isAdmin = user?.role === "creche_admin";

  const [interval, setInterval] = React.useState<Interval>("month");
  const [paymentMode, setPaymentMode] = React.useState<PaymentMode>("subscription");

  const { data: plans, isLoading: plansLoading } = useGetBillingPlans();
  const { data: subscription, isLoading: subLoading } = useGetBillingSubscription();

  const checkoutMutation = useCreateBillingCheckout();
  const portalMutation = useCreateBillingPortal();
  const [cancelingSchedule, setCancelingSchedule] = React.useState(false);
  const [pendingPlanId, setPendingPlanId] = React.useState<number | null>(null);
  const [downgradeViolationsModalOpen, setDowngradeViolationsModalOpen] = React.useState(false);
  const [downgradeViolations, setDowngradeViolations] = React.useState<any>(null);
  const queryClient = useQueryClient();

  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

  // Commercial Proposals (R36.G)
  const [proposalAttemptKeys, setProposalAttemptKeys] = React.useState<Record<number, string>>({});
  const [acceptModalOpen, setAcceptModalOpen] = React.useState(false);
  const [declineModalOpen, setDeclineModalOpen] = React.useState(false);
  const [selectedProposal, setSelectedProposal] = React.useState<any>(null);
  const [declineReason, setDeclineReason] = React.useState("");

  const getProposalAttemptKey = (id: number) => {
    if (!proposalAttemptKeys[id]) {
      const key = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `attempt-${Date.now()}-${Math.random()}`;
      setProposalAttemptKeys((prev) => ({ ...prev, [id]: key }));
      return key;
    }
    return proposalAttemptKeys[id];
  };

  const { data: proposalsData, isLoading: proposalsLoading } = useQuery({
    queryKey: ["billing-proposals"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/api/billing/proposals`, { credentials: "include" });
      if (!res.ok) return { proposals: [] };
      return res.json();
    },
    enabled: isAdmin,
  });

  // Assisted Implementation (R36.G)
  const [serviceModalOpen, setServiceModalOpen] = React.useState(false);
  const [customerNotes, setCustomerNotes] = React.useState("");
  const [serviceAttemptKey, setServiceAttemptKey] = React.useState("");

  // Commercial In-App Notifications (R36.H)
  const { data: notificationsData, refetch: refetchNotifications } = useQuery({
    queryKey: ["billing-commercial-notifications"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/api/billing/commercial-notifications`, { credentials: "include" });
      if (!res.ok) return { notifications: [], unreadCount: 0 };
      return res.json();
    },
    enabled: isAdmin,
  });

  const commercialNotifications = notificationsData?.notifications || [];
  const unreadNotificationsCount = notificationsData?.unreadCount || 0;

  const markNotificationRead = async (id: number) => {
    try {
      await fetch(`${apiBase}/api/billing/commercial-notifications/${id}/read`, {
        method: "POST",
        credentials: "include",
      });
      refetchNotifications();
    } catch (e) {
      console.error(e);
    }
  };

  const markAllNotificationsRead = async () => {
    try {
      await fetch(`${apiBase}/api/billing/commercial-notifications/read-all`, {
        method: "POST",
        credentials: "include",
      });
      refetchNotifications();
    } catch (e) {
      console.error(e);
    }
  };

  const { data: servicesData, isLoading: servicesLoading } = useQuery({
    queryKey: ["billing-platform-services"],
    queryFn: async () => {
      const res = await fetch(`${apiBase}/api/billing/platform-services`, { credentials: "include" });
      if (!res.ok) return { requests: [] };
      return res.json();
    },
    enabled: isAdmin,
  });

  const activeServiceRequest = servicesData?.requests?.find(
    (r: any) => !["completed", "cancelled", "declined"].includes(r.status)
  ) || servicesData?.requests?.[0] || null;

  const proposals = proposalsData?.proposals || [];


  // True whenever the subscription has a Stripe subscription (saved card on file),
  // regardless of which payment mode tab is currently selected.
  const subHasSavedCard =
    subscription?.status === "active" && !!subscription?.stripeSubscriptionId;

  // True when clicking a plan should open the card-selection dialog (subscription mode + saved card).
  const hasActiveSavedCard = paymentMode === "subscription" && subHasSavedCard;

  const { data: savedCardData } = useQuery({
    queryKey: ["billing-saved-card", subscription?.stripeSubscriptionId],
    enabled: subHasSavedCard,
    queryFn: async () => {
      const r = await fetch(`${apiBase}/api/billing/saved-card`, { credentials: "include" });
      if (!r.ok) return { savedCard: null };
      return r.json() as Promise<{
        savedCard: { brand: string; last4: string; expMonth: number; expYear: number } | null;
      }>;
    },
    staleTime: 300_000,
  });
  const savedCard = savedCardData?.savedCard ?? null;

  const handleCancelScheduled = async () => {
    setCancelingSchedule(true);
    try {
      const res = await fetch(
        (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "") + "/api/billing/scheduled",
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) throw new Error("Falha ao cancelar agendamento.");
      queryClient.invalidateQueries();
      toast({ title: "Agendamento cancelado", description: "O plano atual continuará normalmente." });
    } catch {
      toast({ title: "Erro ao cancelar", variant: "destructive" });
    } finally {
      setCancelingSchedule(false);
    }
  };

  React.useEffect(() => {
    if (location.includes("cancelado")) {
      toast({
        title: "Pagamento cancelado",
        description: "Você pode escolher um plano quando quiser.",
      });
    }
  }, [location, toast]);

  const handleCheckout = (planId: number, forceNewCard = false) => {
    const base = window.location.origin + (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    checkoutMutation.mutate(
      {
        data: {
          planId,
          interval,
          paymentMode,
          forceNewCard: forceNewCard || undefined,
          successUrl: `${base}/assinatura/sucesso`,
          cancelUrl: `${base}/assinatura?cancelado=1`,
        } as any,
      },
      {
        onSuccess: (res: any) => {
          if (res.directUpgrade) {
            queryClient.invalidateQueries();
            toast({
              title: "Plano atualizado!",
              description: "O novo plano foi aplicado usando o cartão salvo. A diferença será cobrada proporcionalmente.",
            });
            return;
          }
          if (res.url) window.location.href = res.url;
        },
        onError: (err: any) => {
          const errorData = err?.data;
          if (err?.status === 409 && (errorData?.code === "DOWNGRADE_USAGE_EXCEEDS_LIMITS" || errorData?.violations)) {
            setDowngradeViolations(errorData.violations);
            setDowngradeViolationsModalOpen(true);
            return;
          }
          toast({
            title: "Não foi possível iniciar o checkout",
            description: err?.message ?? "Tente novamente em instantes.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handlePortal = () => {
    portalMutation.mutate(undefined, {
      onSuccess: (res) => {
        if (res.url) window.location.href = res.url;
      },
      onError: (err: Error) => {
        toast({
          title: "Não foi possível abrir o portal",
          description: err?.message ?? "Tente novamente em instantes.",
          variant: "destructive",
        });
      },
    });
  };

  if (plansLoading || subLoading) {
    return <div className="p-8 text-center text-muted-foreground flex items-center justify-center min-h-[60vh]">Carregando...</div>;
  }

  const currentPlanId = subscription?.planId;
  const status = subscription?.status ?? "trial";
  const statusInfo = STATUS_LABELS[status] ?? STATUS_LABELS.trial;
  // Include Enterprise (priceBrl=0, sob medida) but exclude Trial (also priceBrl=0).
  // Enterprise always appears last in the list.
  const paidPlans = (plans ?? [])
    .filter((p) => p.priceBrl > 0 || p.name.toLowerCase() === "enterprise")
    .sort((a, b) => {
      if (a.name.toLowerCase() === "enterprise") return 1;
      if (b.name.toLowerCase() === "enterprise") return -1;
      return 0;
    });

  const discountByInterval = new Map<string, number>();
  for (const plan of paidPlans) {
    for (const price of plan.prices ?? []) {
      if (price.discountPct > 0) discountByInterval.set(price.interval, price.discountPct);
    }
  }

  const currentInterval = subscription?.billingInterval as Interval | null | undefined;
  const sub = subscription as any;

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto pb-24">
      <PageHeader
        title="Assinatura"
        description="Gerencie o plano da sua creche e os pagamentos."
        icon={CreditCard}
      />

      {/* Current subscription summary */}
      <Card className="bg-card border border-border rounded-[24px] shadow-sm">
        <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <div className="h-[60px] w-[60px] rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
               <CalendarClock className="h-6 w-6 text-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center flex-wrap gap-2">
                <span className={cn("text-[11px] font-semibold px-2.5 py-0.5 rounded-full border", statusInfo.className)}>
                  • {statusInfo.label}
                </span>
                {sub?.isGrandfathered && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border bg-warning/15 text-warning border-warning/30">
                    Contrato Legado Preservado (Grandfathered)
                  </span>
                )}
                {sub?.commercialBindingStatus === "unresolved_legacy_contract" && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border bg-primary/15 text-primary border-primary/30">
                    Contrato Legado em Revisão
                  </span>
                )}
              </div>
              <h2 className="text-xl font-display font-bold text-foreground flex items-center flex-wrap gap-2">
                {subscription?.plan?.name ?? "Plano gratuito"}
                <span className="text-[13px] font-medium text-muted-foreground font-sans">
                  · até {subscription?.plan?.petLimit ?? 0} pets
                </span>
                {sub?.contractedPriceCents !== null && sub?.contractedPriceCents !== undefined && (
                  <span className="text-[13px] font-medium text-foreground">
                    · {formatBrl(sub.contractedPriceCents)}
                  </span>
                )}
              </h2>
              {sub?.isGrandfathered && sub?.activeCatalogPriceCents && (
                <div className="text-xs text-muted-foreground">
                  Preço Vigente no Catálogo: {formatBrl(sub.activeCatalogPriceCents)}
                </div>
              )}
              <p className="text-[13px] text-muted-foreground flex items-center gap-1 font-medium">
                {status === "trial"
                  ? `Teste termina em ${formatDate(subscription?.trialEndsAt)}`
                  : status === "active"
                    ? `Válido até ${formatDate(subscription?.currentPeriodEnd)}`
                    : status === "past_due"
                      ? `Pendente desde ${formatDate(subscription?.pastDueSince)}`
                      : ""}
              </p>
            </div>
          </div>

          <div className="hidden md:flex shrink-0">
             {/* Illustration placeholder to match the clipboard with paw in the image */}
             <div className="h-24 w-28 bg-secondary rounded-xl flex items-center justify-center border border-border relative overflow-hidden">
                <Sparkles className="absolute top-2 left-2 h-4 w-4 text-primary opacity-50" />
                <FileText className="h-12 w-12 text-muted-foreground/30" />
                <div className="absolute -bottom-2 -right-2 h-10 w-10 bg-primary rounded-full flex items-center justify-center">
                   <Dog className="h-5 w-5 text-primary-foreground" />
                </div>
             </div>
          </div>
        </CardContent>
      </Card>

      {/* Unified Entitlement Quotas Section (R38.C) */}
      {sub?.quotas && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Pets Quota Card */}
          <Card className="bg-card border border-border rounded-[20px] shadow-sm">
            <CardContent className="p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Dog className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Pets Cadastrados</h3>
                    <p className="text-[11px] text-muted-foreground">Capacidade da creche</p>
                  </div>
                </div>
                {(() => {
                  const pct = sub.quotas.pets.percent ?? 0;
                  if (pct >= 100) {
                    return <Badge variant="destructive" className="text-[10px]">Limite Atingido</Badge>;
                  }
                  if (pct >= 80) {
                    return <Badge variant="warning" className="text-[10px]">Atenção (≥80%)</Badge>;
                  }
                  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Normal</Badge>;
                })()}
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-muted-foreground">
                    {sub.quotas.pets.used} / {sub.quotas.pets.limit} pets
                  </span>
                  <span className={cn(
                    "font-semibold",
                    sub.quotas.pets.percent >= 100 ? "text-destructive" : sub.quotas.pets.percent >= 80 ? "text-warning" : "text-foreground"
                  )}>
                    {sub.quotas.pets.percent}%
                  </span>
                </div>
                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-300 rounded-full",
                      sub.quotas.pets.percent >= 100 ? "bg-destructive" : sub.quotas.pets.percent >= 80 ? "bg-warning" : "bg-primary"
                    )}
                    style={{ width: `${Math.min(sub.quotas.pets.percent, 100)}%` }}
                  />
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                {sub.quotas.pets.available > 0
                  ? `${sub.quotas.pets.available} vaga(s) restante(s)`
                  : "Nenhuma vaga disponível"}
              </p>
            </CardContent>
          </Card>

          {/* Staff Quota Card */}
          <Card className="bg-card border border-border rounded-[20px] shadow-sm">
            <CardContent className="p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Equipe e Convites</h3>
                    <p className="text-[11px] text-muted-foreground">Administradores e funcionários</p>
                  </div>
                </div>
                {(() => {
                  const staff = sub.quotas.staff;
                  if (staff.unlimited) {
                    return <Badge variant="success" className="text-[10px]">Ilimitado</Badge>;
                  }
                  if (staff.enforcementBypassed || staff.enforcementReason === "UNRESOLVED_LEGACY_CONTRACT") {
                    return <Badge variant="secondary" className="text-[10px]">Em Revisão</Badge>;
                  }
                  const pct = staff.percent ?? 0;
                  if (pct >= 100) {
                    return <Badge variant="destructive" className="text-[10px]">Limite Atingido</Badge>;
                  }
                  if (pct >= 80) {
                    return <Badge variant="warning" className="text-[10px]">Atenção (≥80%)</Badge>;
                  }
                  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Normal</Badge>;
                })()}
              </div>

              {sub.quotas.staff.unlimited ? (
                <div className="space-y-1 py-1">
                  <p className="text-sm font-bold text-foreground">Acesso Ilimitado</p>
                  <p className="text-[11px] text-muted-foreground">
                    {sub.quotas.staff.used} membro(s) atualmente ativos no plano Enterprise
                  </p>
                </div>
              ) : (sub.quotas.staff.enforcementBypassed || sub.quotas.staff.enforcementReason === "UNRESOLVED_LEGACY_CONTRACT") ? (
                <div className="space-y-1 py-1">
                  <p className="text-xs font-medium text-foreground">{sub.quotas.staff.used} membro(s) cadastrados</p>
                  <p className="text-[11px] text-primary">
                    Contrato legado sem limite formalizado. Em processo de revisão contratual.
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-muted-foreground">
                        {sub.quotas.staff.used} / {sub.quotas.staff.limit} membros
                      </span>
                      <span className={cn(
                        "font-semibold",
                        (sub.quotas.staff.percent ?? 0) >= 100 ? "text-destructive" : (sub.quotas.staff.percent ?? 0) >= 80 ? "text-warning" : "text-foreground"
                      )}>
                        {sub.quotas.staff.percent ?? 0}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all duration-300 rounded-full",
                          (sub.quotas.staff.percent ?? 0) >= 100 ? "bg-destructive" : (sub.quotas.staff.percent ?? 0) >= 80 ? "bg-warning" : "bg-primary"
                        )}
                        style={{ width: `${Math.min(sub.quotas.staff.percent ?? 0, 100)}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {(sub.quotas.staff.available ?? 0) > 0
                      ? `${sub.quotas.staff.available} vaga(s) restante(s)`
                      : "Limite de equipe atingido"}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Storage Quota Card */}
          <Card className="bg-card border border-border rounded-[20px] shadow-sm">
            <CardContent className="p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Armazenamento em Nuvem</h3>
                    <p className="text-[11px] text-muted-foreground">Fotos, comprovantes e arquivos</p>
                  </div>
                </div>
                {(() => {
                  const storage = sub.quotas.storage;
                  if (storage.enforcementBypassed || storage.enforcementReason === "UNRESOLVED_LEGACY_CONTRACT") {
                    return <Badge variant="secondary" className="text-[10px]">Em Revisão</Badge>;
                  }
                  if (storage.enforcementMode === "ENFORCE" && storage.hardBlocked) {
                    return <Badge variant="destructive" className="text-[10px]">Bloqueado</Badge>;
                  }
                  const pct = storage.percent ?? 0;
                  if (pct >= 100) {
                    if (storage.enforcementMode === "AUDIT") {
                      return <Badge variant="default" className="text-[10px]">Monitoramento</Badge>;
                    }
                    if (storage.enforcementMode === "SHADOW") {
                      return <Badge variant="warning" className="text-[10px]">Observação</Badge>;
                    }
                    return <Badge variant="destructive" className="text-[10px]">Limite Atingido</Badge>;
                  }
                  if (pct >= 80) {
                    return <Badge variant="warning" className="text-[10px]">Atenção (≥80%)</Badge>;
                  }
                  return <Badge variant="outline" className="text-[10px] text-muted-foreground">Normal</Badge>;
                })()}
              </div>

              {(sub.quotas.storage.enforcementBypassed || sub.quotas.storage.enforcementReason === "UNRESOLVED_LEGACY_CONTRACT") ? (
                <div className="space-y-1 py-1">
                  <p className="text-xs font-medium text-foreground">
                    {formatStorageBytes(sub.quotas.storage.usedBytes)} utilizados
                  </p>
                  <p className="text-[11px] text-primary">
                    Contrato legado sem cota de armazenamento formalizada. Em avaliação técnica.
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-muted-foreground">
                        {formatStorageBytes(sub.quotas.storage.usedBytes)} / {formatStorageBytes(sub.quotas.storage.limitBytes)}
                      </span>
                      <span className={cn(
                        "font-semibold",
                        sub.quotas.storage.hardBlocked ? "text-destructive" : (sub.quotas.storage.percent ?? 0) >= 80 ? "text-warning" : "text-foreground"
                      )}>
                        {sub.quotas.storage.percent}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all duration-300 rounded-full",
                          sub.quotas.storage.hardBlocked ? "bg-destructive" : (sub.quotas.storage.percent ?? 0) >= 80 ? "bg-warning" : "bg-primary"
                        )}
                        style={{ width: `${Math.min(sub.quotas.storage.percent, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>
                      {sub.quotas.storage.availableBytes > 0
                        ? `${formatStorageBytes(sub.quotas.storage.availableBytes)} disponíveis`
                        : "Cota esgotada"}
                    </span>
                    <span className="text-[10px] uppercase font-mono tracking-wider opacity-70">
                      Modo: {sub.quotas.storage.enforcementMode}
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Scheduled Plan Change Banner (R38.B / R38.C) */}
      {(sub?.scheduledChange || sub?.scheduledPlanId) && (() => {
        const sc = sub?.scheduledChange;
        const isFailedOverQuota = sc?.scheduledStatus === "FAILED_OVER_QUOTA";
        const targetName = sc?.targetPlanName ?? sub?.scheduledPlanInfo?.name ?? "Novo Plano";
        const targetVersion = sc?.targetPlanVersionNumber ? ` (v${sc.targetPlanVersionNumber})` : "";
        const effectiveDateStr = formatDate(sc?.effectiveDate ?? sub?.scheduledPeriodEnd ?? subscription?.currentPeriodEnd);
        const priceStr = sc?.targetPriceCents ? ` pelo valor de ${formatBrl(sc.targetPriceCents)}` : (sub?.scheduledPriceCents ? ` pelo valor de ${formatBrl(sub.scheduledPriceCents)}` : "");

        if (isFailedOverQuota) {
          return (
            <Card className="bg-destructive/5 border border-destructive/30 rounded-[20px] shadow-sm">
              <CardContent className="p-4 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-destructive">
                          Downgrade Agendado Não Aplicado — Limites Excedidos
                        </p>
                        <Badge variant="destructive" className="text-[10px] uppercase">
                          Failed Over Quota
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        A mudança para <strong>{targetName}{targetVersion}</strong> prevista para {effectiveDateStr} não pôde ser aplicada porque o uso da creche excede as cotas do plano de destino. Sua assinatura atual permanece ativa.
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0"
                    onClick={async () => {
                      try {
                        await fetch(`${apiBase}/api/billing/scheduled`, { method: "DELETE", credentials: "include" });
                        queryClient.invalidateQueries();
                        toast({ title: "Agendamento cancelado", description: "O agendamento com falha de cota foi cancelado." });
                      } catch {
                        toast({ title: "Erro", description: "Não foi possível cancelar o agendamento.", variant: "destructive" });
                      }
                    }}
                  >
                    Cancelar Agendamento
                  </Button>
                </div>

                {sc?.violations && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-destructive/15 text-xs">
                    {sc.violations.pets && (
                      <div className="p-2 rounded bg-destructive/10 text-destructive-foreground">
                        <span className="font-semibold">Pets:</span> {sc.violations.pets.current} / {sc.violations.pets.limit} (+{sc.violations.pets.excess} excedente)
                      </div>
                    )}
                    {sc.violations.staff && (
                      <div className="p-2 rounded bg-destructive/10 text-destructive-foreground">
                        <span className="font-semibold">Equipe:</span> {sc.violations.staff.current} / {sc.violations.staff.limit} (+{sc.violations.staff.excess} excedente)
                      </div>
                    )}
                    {sc.violations.storage && (
                      <div className="p-2 rounded bg-destructive/10 text-destructive-foreground">
                        <span className="font-semibold">Armazenamento:</span> {formatStorageBytes(sc.violations.storage.currentBytes)} / {formatStorageBytes(sc.violations.storage.limitBytes)} (+{formatStorageBytes(sc.violations.storage.excessBytes)} excedente)
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        }

        return (
          <Card className="bg-warning/5 border border-warning/30 rounded-[20px] shadow-sm">
            <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CalendarClock className="h-5 w-5 text-warning shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Mudança de Plano Agendada
                  </p>
                  <p className="text-xs text-muted-foreground">
                    O plano será alterado para <strong>{targetName}{targetVersion}</strong> a partir de <strong>{effectiveDateStr}</strong>{priceStr}.
                  </p>
                  {sc && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Cotas previstas: {sc.targetPetLimit} pets • {sc.targetStaffLimit !== null ? `${sc.targetStaffLimit} equipe` : "Equipe ilimitada"} • {formatStorageBytes(sc.targetStorageBytesLimit)}
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs text-destructive border-destructive/30 hover:bg-destructive/10 shrink-0"
                onClick={async () => {
                  try {
                    await fetch(`${apiBase}/api/billing/scheduled`, { method: "DELETE", credentials: "include" });
                    queryClient.invalidateQueries();
                    toast({ title: "Agendamento cancelado", description: "A mudança de plano agendada foi cancelada." });
                  } catch {
                    toast({ title: "Erro", description: "Não foi possível cancelar o agendamento.", variant: "destructive" });
                  }
                }}
              >
                Cancelar Mudança
              </Button>
            </CardContent>
          </Card>
        );
      })()}

      {/* SEÇÃO: ATUALIZAÇÕES COMERCIAIS (R36.H) */}
      {isAdmin && commercialNotifications.length > 0 && (
        <Card className="bg-card border border-border rounded-[24px] shadow-sm overflow-hidden mb-8">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Bell className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-display font-bold text-foreground">Atualizações Comerciais</h3>
                    {unreadNotificationsCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {unreadNotificationsCount} {unreadNotificationsCount === 1 ? "nova" : "novas"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Comunicações e avisos contratuais da sua assinatura.</p>
                </div>
              </div>
              {unreadNotificationsCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={markAllNotificationsRead}
                  className="text-xs h-8"
                >
                  Marcar todas como lidas
                </Button>
              )}
            </div>

            <div className="divide-y border rounded-xl overflow-hidden">
              {commercialNotifications.map((n: any) => {
                const isUnread = !n.readAt;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition-colors",
                      isUnread ? "bg-primary/5" : "bg-card"
                    )}
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {isUnread && <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />}
                        <span className="font-semibold text-sm text-foreground">{n.title}</span>
                        <Badge variant="outline" className="text-[10px] uppercase font-mono">
                          {n.category}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{n.body}</p>
                      <p className="text-[10px] text-muted-foreground">{formatDate(n.createdAt)}</p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {n.deepLink && (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => {
                            if (isUnread) markNotificationRead(n.id);
                            if (n.deepLink && n.deepLink.startsWith("/")) {
                              if (typeof setLocation === "function") {
                                setLocation(n.deepLink);
                              } else {
                                window.location.href = n.deepLink;
                              }
                            }
                          }}
                        >
                          Visualizar
                        </Button>
                      )}
                      {isUnread && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-8 text-muted-foreground hover:text-foreground"
                          onClick={() => markNotificationRead(n.id)}
                        >
                          Marcar como lida
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* SEÇÃO: PROPOSTAS COMERCIAIS (R36.G) */}
      {isAdmin && proposals.length > 0 && (
        <Card className="bg-card border border-border rounded-[24px] shadow-sm overflow-hidden">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-bold text-foreground">Propostas Comerciais</h3>
                  <p className="text-xs text-muted-foreground">Propostas formais com termos exclusivos para sua creche.</p>
                </div>
              </div>
            </div>

            <div className="divide-y border rounded-xl overflow-hidden">
              {proposals.map((p: any) => {
                const snap = p.snapshotJson || {};
                const isSent = p.status === "sent";
                const isAccepted = p.status === "accepted";
                const isExpired = p.validUntil && new Date(p.validUntil) <= new Date();
                const isPendingActivation = p.activationStatus === "pending_activation" || p.activationStatus === "activation_failed";

                return (
                  <div key={p.id} className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">#{p.id} {p.title || "Proposta Comercial"}</span>
                        <Badge variant={isAccepted ? "default" : isExpired ? "destructive" : isSent ? "outline" : "secondary"}>
                          {isExpired && isSent ? "Expirada" : p.status}
                        </Badge>
                        {isAccepted && isPendingActivation && (
                          <Badge variant="warning">
                            Ativação em Processamento
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Plano: <strong className="text-foreground">{snap.planName || "Personalizado"}</strong> •
                        Preço Efetivo: <strong className="text-foreground">{formatBrl(snap.displayedEffectivePriceCents)}</strong>{INTERVAL_SUFFIX[snap.billingInterval as Interval] || "/mês"} •
                        Limite Pets: <strong className="text-foreground">{snap.entitlementPetLimit || "Padrão"}</strong>
                      </p>
                      {p.validUntil && (
                        <p className="text-[11px] text-muted-foreground">
                          Válida até: {formatDate(p.validUntil)}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isSent && !isExpired && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              setSelectedProposal(p);
                              setDeclineReason("");
                              setDeclineModalOpen(true);
                            }}
                          >
                            Recusar
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              setSelectedProposal(p);
                              setAcceptModalOpen(true);
                            }}
                          >
                            Aceitar Proposta
                          </Button>
                        </>
                      )}
                      {isAccepted && (
                        <div className="flex items-center gap-1.5 text-xs text-success font-medium">
                          <CheckCircle className="h-4 w-4" /> Aceita em {formatDate(p.acceptedAt)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* SEÇÃO: IMPLANTAÇÃO ASSISTIDA (R36.G) */}
      {isAdmin && (
        <Card className="bg-card border border-border rounded-[24px] shadow-sm overflow-hidden">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                  <Wrench className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-display font-bold text-foreground">Implantação Assistida</h3>
                  <p className="text-xs text-muted-foreground">Onboarding dedicado e consultoria técnica com especialistas da plataforma.</p>
                </div>
              </div>

              {!activeServiceRequest && (
                <Button
                  size="sm"
                  onClick={() => {
                    setCustomerNotes("");
                    setServiceAttemptKey(typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `svc-${Date.now()}`);
                    setServiceModalOpen(true);
                  }}
                >
                  Solicitar Implantação
                </Button>
              )}
            </div>

            {activeServiceRequest ? (
              <div className="border rounded-xl p-4 bg-muted/20 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">Solicitação #{activeServiceRequest.id}</span>
                    <Badge variant={activeServiceRequest.status === "completed" ? "default" : "outline"}>
                      {activeServiceRequest.status}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Solicitado em: {formatDate(activeServiceRequest.createdAt)}
                  </span>
                </div>

                {/* Status description */}
                {activeServiceRequest.status === "requested" && (
                  <p className="text-xs text-muted-foreground">
                    Sua solicitação foi recebida e está aguardando análise pela equipe técnica da ArkPet.
                  </p>
                )}
                {activeServiceRequest.status === "under_review" && (
                  <p className="text-xs text-muted-foreground">
                    Nossa equipe está analisando o escopo da sua creche para formular uma proposta de atendimento.
                  </p>
                )}
                {activeServiceRequest.status === "proposal_sent" && (
                  <div className="space-y-2 pt-2 border-t">
                    <p className="text-sm font-medium text-foreground">
                      Orçamento Disponível: <strong className="text-primary">{formatBrl(activeServiceRequest.quotedPriceCents)}</strong>
                    </p>
                    {activeServiceRequest.adminNotes && (
                      <p className="text-xs text-muted-foreground italic">
                        "{activeServiceRequest.adminNotes}"
                      </p>
                    )}
                    <div className="flex items-center gap-2 pt-2">
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            const res = await fetch(`${apiBase}/api/billing/platform-services/${activeServiceRequest.id}/accept-quote`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              credentials: "include",
                            });
                            if (!res.ok) {
                              const err = await res.json();
                              throw new Error(err.message || "Erro ao aceitar orçamento");
                            }
                            queryClient.invalidateQueries({ queryKey: ["billing-platform-services"] });
                            toast({ title: "Orçamento aceito!", description: "Avançando para as próximas etapas." });
                          } catch (err: any) {
                            toast({ title: "Erro", description: err.message, variant: "destructive" });
                          }
                        }}
                      >
                        Aceitar Orçamento
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={async () => {
                          if (confirm("Deseja recusar e cancelar esta solicitação?")) {
                            try {
                              const res = await fetch(`${apiBase}/api/billing/platform-services/${activeServiceRequest.id}/cancel`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ reason: "Recusa de orçamento pelo cliente" }),
                                credentials: "include",
                              });
                              if (!res.ok) {
                                const err = await res.json();
                                throw new Error(err.message || "Erro ao cancelar");
                              }
                              queryClient.invalidateQueries({ queryKey: ["billing-platform-services"] });
                              toast({ title: "Solicitação cancelada", description: "O orçamento foi recusado." });
                            } catch (err: any) {
                              toast({ title: "Erro", description: err.message, variant: "destructive" });
                            }
                          }
                        }}
                      >
                        Recusar
                      </Button>
                    </div>
                  </div>
                )}
                {activeServiceRequest.status === "payment_pending" && (
                  <div className="space-y-2 pt-2 border-t">
                    <p className="text-xs text-muted-foreground">
                      Orçamento aceito. Para prosseguir com o agendamento, realize o pagamento avulso seguro com cartão:
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      Valor: {formatBrl(activeServiceRequest.quotedPriceCents)}
                    </p>
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          const res = await fetch(`${apiBase}/api/billing/platform-services/${activeServiceRequest.id}/create-checkout-session`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              successUrl: `${window.location.origin}/billing?session_id={CHECKOUT_SESSION_ID}`,
                              cancelUrl: `${window.location.origin}/billing`,
                            }),
                            credentials: "include",
                          });
                          if (!res.ok) {
                            const err = await res.json();
                            throw new Error(err.message || "Erro ao iniciar checkout");
                          }
                          const data = await res.json();
                          if (data.checkoutUrl) {
                            window.location.href = data.checkoutUrl;
                          } else if (data.status === "paid") {
                            queryClient.invalidateQueries({ queryKey: ["billing-platform-services"] });
                            toast({ title: "Pagamento já confirmado!", description: "Sua solicitação está paga." });
                          }
                        } catch (err: any) {
                          toast({ title: "Erro no checkout", description: err.message, variant: "destructive" });
                        }
                      }}
                      className="flex items-center gap-1.5"
                    >
                      <CreditCard className="h-4 w-4" /> Pagar com Cartão
                    </Button>
                  </div>
                )}
                {activeServiceRequest.status === "paid" && (
                  <p className="text-xs text-success font-medium flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4" /> Pagamento confirmado! Nossa equipe entrará em contato para agendar a sessão.
                  </p>
                )}
                {activeServiceRequest.status === "scheduled" && (
                  <p className="text-xs text-primary font-medium">
                    📅 Sessão agendada para: {activeServiceRequest.scheduledFor ? new Date(activeServiceRequest.scheduledFor).toLocaleString("pt-BR") : "A confirmar"}
                  </p>
                )}
                {activeServiceRequest.status === "in_progress" && (
                  <p className="text-xs text-warning font-medium">
                    ⚡ Implantação em andamento com o suporte ArkPet.
                  </p>
                )}
                {activeServiceRequest.status === "completed" && (
                  <p className="text-xs text-success font-medium flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4" /> Implantação concluída com sucesso!
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Precisa de auxílio para cadastrar seus pets, configurar turmas e treinar sua equipe?
                Solicite uma Implantação Assistida dedicada com nossos especialistas.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isAdmin && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/10 border border-primary/20 text-sm text-primary font-medium">
          <ShieldCheck className="h-5 w-5 flex-shrink-0" />
          <p>Apenas o administrador da creche pode alterar o plano ou os dados de pagamento.</p>
        </div>
      )}

      {/* Plan cards */}
      <div>
        {/* Header row: title + interval selector */}
        <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Planos disponíveis
          </h3>

          {/* Billing period selector */}
          <div className="w-full sm:w-auto">
            <div className="grid grid-cols-2 sm:flex sm:flex-row items-center bg-secondary p-1.5 rounded-2xl sm:rounded-full gap-1 border border-border">
              {INTERVALS.map((opt) => {
                const discount = discountByInterval.get(opt);
                const isActive = interval === opt;
                return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setInterval(opt)}
                  className={cn(
                    "relative px-2 sm:px-4 py-2 sm:py-2.5 min-h-[44px] text-[12px] sm:text-[13px] font-semibold rounded-xl sm:rounded-full transition-all text-center flex-1",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {INTERVAL_LABELS[opt]}
                  {discount ? (
                    <span className={cn("ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded", isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-success/15 text-success")}>
                      −{discount}%
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

        {/* Payment method selector */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <button
            type="button"
            onClick={() => setPaymentMode("subscription")}
            className={cn(
              "flex-1 flex items-center gap-4 p-5 rounded-[20px] border transition-all text-left min-h-[80px]",
              paymentMode === "subscription"
                ? "border-primary/40 bg-primary/5 shadow-sm"
                : "border-border bg-card opacity-80 hover:opacity-100",
            )}
          >
            <div className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0",
              paymentMode === "subscription" ? "bg-transparent text-primary" : "bg-transparent text-muted-foreground",
            )}>
              <CreditCard className="h-6 w-6 stroke-[1.5px]" />
            </div>
            <div className="flex-1">
              <p className={cn("text-[15px] font-bold", paymentMode === "subscription" ? "text-foreground" : "text-muted-foreground")}>
                Cartão de crédito
              </p>
              <p className="text-[12px] text-muted-foreground/80 mt-0.5 font-medium">Cobrança automática · sem precisar renovar</p>
            </div>
            <div className="flex-shrink-0">
               {paymentMode === "subscription" ? (
                  <div className="h-5 w-5 rounded-full border-2 border-primary flex items-center justify-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                  </div>
               ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
               )}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setPaymentMode("payment")}
            className={cn(
              "flex-1 flex items-center gap-4 p-5 rounded-[20px] border transition-all text-left min-h-[80px]",
              paymentMode === "payment"
                ? "border-primary/40 bg-primary/5 shadow-sm"
                : "border-border bg-card opacity-80 hover:opacity-100",
            )}
          >
            <div className={cn(
              "h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0",
              paymentMode === "payment" ? "bg-transparent text-primary" : "bg-transparent text-muted-foreground",
            )}>
              <QrCode className="h-6 w-6 stroke-[1.5px]" />
            </div>
            <div className="flex-1">
              <p className={cn("text-[15px] font-bold", paymentMode === "payment" ? "text-foreground" : "text-muted-foreground")}>
                PIX · Boleto · Cartão avulso
              </p>
              <p className="text-[12px] text-muted-foreground/80 mt-0.5 font-medium">Pague uma vez · renove manualmente ao vencer</p>
            </div>
            <div className="flex-shrink-0">
               {paymentMode === "payment" ? (
                  <div className="h-5 w-5 rounded-full border-2 border-primary flex items-center justify-center">
                    <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                  </div>
               ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30" />
               )}
            </div>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {paidPlans.map((plan) => {
            const isCurrent =
              plan.id === currentPlanId &&
              status === "active" &&
              (currentInterval ?? "month") === interval;

            const isScheduled = (subscription as any)?.scheduledPlanId === plan.id;

            const price = (plan.prices ?? []).find((p) => p.interval === interval);
            const periodPrice = price?.priceBrl ?? plan.priceBrl * INTERVAL_MONTHS[interval];
            // Subscription mode needs a Stripe price id; payment mode is always available.
            const isAvailable = paymentMode === "payment"
              ? true
              : (interval === "month" ? true : price?.available ?? false);
            const equivalentMonthly = Math.round(periodPrice / INTERVAL_MONTHS[interval]);

            // Is this a downgrade compared to the current active plan?
            const currentPlanPrice = (subscription as any)?.plan?.priceBrl ?? 0;
            const hasActivePeriod = status === "active" && subscription?.currentPeriodEnd && new Date(subscription.currentPeriodEnd) > new Date();
            const wouldBeDowngrade = hasActivePeriod && plan.priceBrl < currentPlanPrice;
            const scheduledFromDate = subscription?.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "";

            const buttonLabel = isCurrent
              ? "Plano atual"
              : isScheduled
                ? "Agendado ✓"
                : !isAvailable
                  ? "Indisponível"
                  : status === "active" && wouldBeDowngrade
                    ? `Agendar para ${scheduledFromDate}`
                    : status === "active"
                      ? "Atualizar agora"
                      : paymentMode === "payment"
                        ? "Pagar agora"
                        : "Assinar";

            return (
              <Card
                key={plan.id}
                className={cn(
                  "transition-all duration-200 border bg-card rounded-[24px] flex flex-col shadow-sm hover:shadow-md",
                  isCurrent ? "border-primary shadow-[0_0_15px_rgba(var(--primary-rgb),0.1)]"
                  : isScheduled ? "border-warning/50 shadow-[0_0_15px_rgba(var(--warning-rgb),0.1)]"
                  : "border-border hover:border-border/80",
                )}
              >
                <CardContent className="p-6 flex flex-col h-full flex-1">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-display font-bold text-foreground text-lg">{plan.name}</h4>
                    {isCurrent && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/15 px-2 py-0.5 rounded-full border border-primary/20">
                        Atual
                      </span>
                    )}
                    {isScheduled && !isCurrent && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-warning-foreground bg-warning/20 px-2 py-0.5 rounded-full border border-warning/30">
                        Agendado
                      </span>
                    )}
                  </div>
                  <div className="mb-2">
                    {plan.name.toLowerCase() === "enterprise" ? (
                      <span className="text-2xl font-bold text-foreground">Sob medida</span>
                    ) : (
                      <>
                         <div className="flex items-baseline gap-1">
                           <span className="text-3xl font-display font-bold text-foreground tracking-tight">{formatBrl(periodPrice)}</span>
                           <span className="text-sm font-medium text-muted-foreground">{INTERVAL_SUFFIX[interval]}</span>
                         </div>
                      </>
                    )}
                  </div>
                  <div className="mb-6 h-5">
                    {plan.name.toLowerCase() !== "enterprise" && interval !== "month" ? (
                      <span className="text-xs font-semibold text-success bg-success/10 px-2 py-1 rounded border border-success/20">
                        equivale a {formatBrl(equivalentMonthly)}/mês
                        {price?.discountPct ? ` · economize ${price.discountPct}%` : ""}
                      </span>
                    ) : null}
                  </div>
                  
                  {plan.name.toLowerCase() === "enterprise" ? (
                    <div className="mb-8 flex-1 flex flex-col justify-start">
                      <p className="text-[14px] text-muted-foreground leading-relaxed font-medium">
                        Caso os planos padrões não atendam a demanda da sua creche, o plano Enterprise é construído de forma totalmente customizada para a sua operação.
                      </p>
                    </div>
                  ) : (
                    <ul className="space-y-3 mb-8 flex-1">
                      <li className="flex items-start gap-2.5 text-sm text-foreground font-medium">
                        <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5 stroke-[3px]" /> Até {plan.petLimit} pets
                      </li>
                      {plan.description && (
                        <li className="flex items-start gap-2.5 text-sm text-foreground font-medium">
                          <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5 stroke-[3px]" /> {plan.description}
                        </li>
                      )}
                    </ul>
                  )}
                  <div className="mt-auto">
                    {plan.name.toLowerCase() === "enterprise" ? (
                      <Button
                        className="w-full bg-[#25D366] hover:bg-[#128C7E] text-primary-foreground border-0 h-12 rounded-xl text-[15px] font-bold"
                        onClick={() => window.open(`https://wa.me/${ENTERPRISE_WHATSAPP_NUMBER}?text=${ENTERPRISE_WHATSAPP_MSG}`, '_blank')}
                      >
                        Falar no WhatsApp
                      </Button>
                    ) : (
                      <Button
                        className="w-full border h-12 rounded-xl text-[15px] font-bold"
                        variant={isCurrent ? "outline" : "default"}
                        disabled={!isAdmin || isCurrent || !isAvailable || checkoutMutation.isPending}
                        onClick={() => {
                          if (hasActiveSavedCard) {
                            setPendingPlanId(plan.id);
                          } else {
                            handleCheckout(plan.id);
                          }
                        }}
                      >
                        {checkoutMutation.isPending && (checkoutMutation.variables?.data as any)?.planId === plan.id ? "Aguarde..." : buttonLabel}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>


      {/* DIÁLOGO: ACEITAR PROPOSTA COMERCIAL */}
      <Modal
        isOpen={acceptModalOpen}
        onClose={() => setAcceptModalOpen(false)}
        title="Aceitar Proposta Comercial"
        description="Ao aceitar esta proposta, você concorda formalmente com os termos apresentados. As condições comerciais serão ativadas na sua assinatura."
      >
        <div className="py-2 space-y-3 text-sm">
          <p><strong>Proposta:</strong> #{selectedProposal?.id} {selectedProposal?.title}</p>
          <p><strong>Valor Efetivo:</strong> {formatBrl(selectedProposal?.snapshotJson?.displayedEffectivePriceCents)}</p>
          <p><strong>Limite de Pets:</strong> {selectedProposal?.snapshotJson?.entitlementPetLimit || "Padrão"}</p>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setAcceptModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                const attemptKey = getProposalAttemptKey(selectedProposal.id);
                try {
                  const res = await fetch(`${apiBase}/api/billing/proposals/${selectedProposal.id}/accept`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "x-idempotency-key": attemptKey,
                    },
                    credentials: "include",
                  });
                  if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || "Erro ao aceitar proposta");
                  }
                  const data = await res.json();
                  queryClient.invalidateQueries({ queryKey: ["billing-proposals"] });
                  queryClient.invalidateQueries({ queryKey: ["getBillingSubscription"] });
                  setAcceptModalOpen(false);
                  toast({
                    title: "Proposta aceita com sucesso!",
                    description: data.message || "Condições comerciais aceitas.",
                  });
                } catch (err: any) {
                  toast({ title: "Erro ao aceitar proposta", description: err.message, variant: "destructive" });
                }
              }}
            >
              Confirmar Aceite
            </Button>
          </div>
        </div>
      </Modal>

      {/* DIÁLOGO: RECUSAR PROPOSTA COMERCIAL */}
      <Modal
        isOpen={declineModalOpen}
        onClose={() => setDeclineModalOpen(false)}
        title="Recusar Proposta Comercial"
        description="Informe opcionalmente o motivo da recusa para nossa equipe."
      >
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Motivo da Recusa (opcional)</Label>
            <Textarea
              placeholder="Ex: Condições fora do orçamento atual..."
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setDeclineModalOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  const res = await fetch(`${apiBase}/api/billing/proposals/${selectedProposal.id}/decline`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reason: declineReason.trim() || undefined }),
                    credentials: "include",
                  });
                  if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || "Erro ao recusar proposta");
                  }
                  queryClient.invalidateQueries({ queryKey: ["billing-proposals"] });
                  setDeclineModalOpen(false);
                  toast({ title: "Proposta recusada", description: "O status foi atualizado." });
                } catch (err: any) {
                  toast({ title: "Erro ao recusar", description: err.message, variant: "destructive" });
                }
              }}
            >
              Confirmar Recusa
            </Button>
          </div>
        </div>
      </Modal>

      {/* DIÁLOGO: SOLICITAR IMPLANTAÇÃO ASSISTIDA */}
      <Modal
        isOpen={serviceModalOpen}
        onClose={() => setServiceModalOpen(false)}
        title="Solicitar Implantação Assistida"
        description="Nossa equipe entrará em contato para alinhar o escopo e enviar uma proposta ou cortesia."
      >
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Observações / Necessidades da Creche (opcional)</Label>
            <Textarea
              placeholder="Ex: Temos 60 pets, gostaríamos de apoio para migrar os dados das fichas..."
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setServiceModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                try {
                  const res = await fetch(`${apiBase}/api/billing/platform-services/request`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "x-idempotency-key": serviceAttemptKey,
                    },
                    body: JSON.stringify({ customerNotes: customerNotes.trim() || undefined }),
                    credentials: "include",
                  });
                  if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.message || "Erro ao solicitar serviço");
                  }
                  queryClient.invalidateQueries({ queryKey: ["billing-platform-services"] });
                  setServiceModalOpen(false);
                  toast({
                    title: "Solicitação enviada com sucesso!",
                    description: "Nossa equipe entrará em contato em breve.",
                  });
                } catch (err: any) {
                  toast({ title: "Erro ao solicitar", description: err.message, variant: "destructive" });
                }
              }}
            >
              Enviar Solicitação
            </Button>
          </div>
        </div>
      </Modal>

      {/* Diálogo de seleção de cartão — exibido quando o cliente já tem assinatura ativa */}
      <AlertDialog
        open={pendingPlanId !== null && hasActiveSavedCard}
        onOpenChange={(open) => !open && setPendingPlanId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Como deseja pagar?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {savedCard ? (
                <>
                  Você tem um cartão salvo:{" "}
                  <span className="font-medium text-foreground capitalize">{savedCard.brand}</span>{" "}
                  •••• {savedCard.last4} (val.{" "}
                  {String(savedCard.expMonth).padStart(2, "0")}/{savedCard.expYear}).
                </>
              ) : (
                "Você tem um método de pagamento salvo nessa assinatura."
              )}{" "}
              Deseja usá-lo ou informar um novo cartão?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingPlanId(null)} className="h-11">Cancelar</AlertDialogCancel>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                const id = pendingPlanId!;
                setPendingPlanId(null);
                handleCheckout(id, true);
              }}
            >
              Usar outro cartão
            </Button>
            <AlertDialogAction
              className="h-11"
              onClick={() => {
                const id = pendingPlanId!;
                setPendingPlanId(null);
                handleCheckout(id);
              }}
            >
              {savedCard
                ? `Usar ${savedCard.brand.charAt(0).toUpperCase() + savedCard.brand.slice(1)} •••• ${savedCard.last4}`
                : "Usar cartão salvo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Downgrade Incompatibility Modal (R38.C DEC-12) */}
      <Modal
        isOpen={downgradeViolationsModalOpen}
        onClose={() => setDowngradeViolationsModalOpen(false)}
        title="Downgrade Não Permitido — Uso Atual Excede Limites"
      >
        <div className="space-y-4 pt-2">
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Não é possível agendar o downgrade no momento.</p>
              <p className="text-xs text-muted-foreground mt-1">
                O uso atual da sua creche excede as cotas do plano selecionado. Para realizar o downgrade, reduza o uso dos recursos abaixo:
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {downgradeViolations?.pets && (
              <div className="p-3 bg-muted/50 rounded-xl border border-border flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Dog className="h-4 w-4 text-primary" />
                  <span className="font-semibold">Pets Ativos:</span>
                </div>
                <div>
                  Uso Atual: <strong>{downgradeViolations.pets.current}</strong> · Limite do Plano: <strong>{downgradeViolations.pets.limit}</strong>
                  <span className="text-destructive font-semibold ml-2">(+{downgradeViolations.pets.excess} excedente)</span>
                </div>
              </div>
            )}

            {downgradeViolations?.staff && (
              <div className="p-3 bg-muted/50 rounded-xl border border-border flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <span className="font-semibold">Membros da Equipe:</span>
                </div>
                <div>
                  Uso Atual: <strong>{downgradeViolations.staff.current}</strong> · Limite do Plano: <strong>{downgradeViolations.staff.limit}</strong>
                  <span className="text-destructive font-semibold ml-2">(+{downgradeViolations.staff.excess} excedente)</span>
                </div>
              </div>
            )}

            {downgradeViolations?.storage && (
              <div className="p-3 bg-muted/50 rounded-xl border border-border flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-primary" />
                  <span className="font-semibold">Armazenamento:</span>
                </div>
                <div>
                  Uso Atual: <strong>{formatStorageBytes(downgradeViolations.storage.currentBytes)}</strong> · Limite: <strong>{formatStorageBytes(downgradeViolations.storage.limitBytes)}</strong>
                  <span className="text-destructive font-semibold ml-2">(+{formatStorageBytes(downgradeViolations.storage.excessBytes)} excedente)</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              onClick={() => setDowngradeViolationsModalOpen(false)}
              className="px-6"
            >
              Entendido
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
