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
import { CreditCard, Check, Sparkles, ExternalLink, ShieldCheck, RefreshCw, Zap, CalendarClock, X } from "lucide-react";
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
  trial: { label: "Período de teste", className: "bg-blue-500/15 text-blue-300 border-blue-500/25" },
  active: { label: "Ativa", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/25" },
  past_due: { label: "Pagamento pendente", className: "bg-amber-500/15 text-amber-300 border-amber-500/25" },
  suspended: { label: "Suspensa", className: "bg-red-500/15 text-red-300 border-red-500/25" },
  cancelled: { label: "Cancelada", className: "bg-white/10 text-muted-foreground border-white/15" },
};

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export default function Billing() {
  const { user } = useAuth();
  const [location] = useLocation();
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
  const queryClient = useQueryClient();

  const apiBase = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

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
      onError: (err: any) => {
        toast({
          title: "Não foi possível abrir o portal",
          description: err?.message ?? "Tente novamente em instantes.",
          variant: "destructive",
        });
      },
    });
  };

  if (plansLoading || subLoading) {
    return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;
  }

  const currentPlanId = subscription?.planId;
  const status = subscription?.status ?? "trial";
  const statusInfo = STATUS_LABELS[status] ?? STATUS_LABELS.trial;
  const paidPlans = (plans ?? []).filter((p) => p.priceBrl > 0);

  const discountByInterval = new Map<string, number>();
  for (const plan of paidPlans) {
    for (const price of plan.prices ?? []) {
      if (price.discountPct > 0) discountByInterval.set(price.interval, price.discountPct);
    }
  }

  const currentInterval = subscription?.billingInterval as Interval | null | undefined;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl">
      <PageHeader
        title="Assinatura"
        description="Gerencie o plano da sua creche e os pagamentos."
        icon={CreditCard}
      />

      {/* Current subscription summary */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-lg font-display font-semibold text-white">
                  {subscription?.plan?.name ?? "—"}
                </h2>
                <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full border", statusInfo.className)}>
                  {statusInfo.label}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {subscription?.plan && subscription.plan.priceBrl > 0
                  ? `${formatBrl(subscription.plan.priceBrl)} / mês · até ${subscription.plan.petLimit} pets${
                      currentInterval && currentInterval !== "month"
                        ? ` · cobrança ${INTERVAL_LABELS[currentInterval].toLowerCase()}`
                        : ""
                    }`
                  : `Plano gratuito · até ${subscription?.plan?.petLimit ?? 0} pets`}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {status === "trial"
                  ? `Teste termina em ${formatDate(subscription?.trialEndsAt)}`
                  : status === "active"
                    ? `Válido até ${formatDate(subscription?.currentPeriodEnd)}`
                    : status === "past_due"
                      ? `Pendente desde ${formatDate(subscription?.pastDueSince)}`
                      : ""}
              </p>

              {/* Saved card display */}
              {savedCard && (
                <div className="flex items-center gap-2 mt-2">
                  <CreditCard className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-xs text-muted-foreground capitalize">
                    {savedCard.brand} •••• {savedCard.last4}
                    <span className="text-white/30 mx-1">·</span>
                    val. {String(savedCard.expMonth).padStart(2, "0")}/{savedCard.expYear}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handlePortal}
                      disabled={portalMutation.isPending}
                      className="text-xs text-primary hover:text-primary/80 underline underline-offset-2 transition-colors disabled:opacity-50"
                    >
                      Trocar cartão
                    </button>
                  )}
                </div>
              )}

              {/* Scheduled plan change banner */}
              {(subscription as any)?.scheduledPlanId && (subscription as any)?.scheduledPlanInfo?.name && (
                <div className="mt-3 flex items-start justify-between gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25">
                  <div className="flex items-start gap-2">
                    <CalendarClock className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-amber-300">Mudança agendada</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        A partir de {formatDate((subscription as any).currentPeriodEnd)}, muda para{" "}
                        <span className="text-white font-medium">{(subscription as any).scheduledPlanInfo.name}</span>
                        {" "}· até {(subscription as any).scheduledPlanInfo.petLimit === 999999 ? "ilimitado" : `${(subscription as any).scheduledPlanInfo.petLimit} pets`}
                        {(subscription as any).scheduledPeriodEnd
                          ? ` · válido até ${formatDate((subscription as any).scheduledPeriodEnd)}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={handleCancelScheduled}
                      disabled={cancelingSchedule}
                      className="flex-shrink-0 text-muted-foreground hover:text-white transition-colors"
                      title="Cancelar agendamento"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* Pet usage bar */}
              {subscription?.plan && (() => {
                const petCount = (subscription as any).petCount ?? 0;
                const petLimit = subscription.plan.petLimit ?? 0;
                const pct = petLimit > 0 ? Math.min(100, Math.round((petCount / petLimit) * 100)) : 0;
                const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-500";
                return (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">Pets cadastrados</span>
                      <span className="text-xs font-medium text-white">
                        {petCount} / {petLimit === 999999 ? "∞" : petLimit}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10">
                      <div
                        className={`h-1.5 rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>

            {isAdmin && subscription?.stripeCustomerId && (
              <Button variant="ghost" onClick={handlePortal} isLoading={portalMutation.isPending}>
                <ExternalLink className="mr-2 h-4 w-4" /> Gerenciar pagamento
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!isAdmin && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-sm text-blue-300">
          <ShieldCheck className="h-5 w-5 flex-shrink-0" />
          <p>Apenas o administrador da creche pode alterar o plano ou os dados de pagamento.</p>
        </div>
      )}

      {/* Plan cards */}
      <div>
        {/* Header row: title + interval selector */}
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Planos disponíveis
          </h3>

          {/* Billing period selector */}
          <div className="flex items-center rounded-xl border border-white/10 bg-white/5 p-1 w-full sm:w-auto">
            {INTERVALS.map((opt) => {
              const discount = discountByInterval.get(opt);
              const isActive = interval === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setInterval(opt)}
                  className={cn(
                    "flex-1 sm:flex-none relative px-2.5 py-1.5 text-xs font-medium rounded-lg transition-all text-center",
                    isActive
                      ? "bg-primary text-primary-foreground shadow"
                      : "text-muted-foreground hover:text-white",
                  )}
                >
                  {INTERVAL_LABELS[opt]}
                  {discount ? (
                    <span className={cn("ml-1 text-[10px] font-bold", isActive ? "text-primary-foreground/90" : "text-emerald-400")}>
                      −{discount}%
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Payment method selector */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5">
          <button
            type="button"
            onClick={() => setPaymentMode("subscription")}
            className={cn(
              "flex-1 flex items-start gap-3 p-4 rounded-xl border transition-all text-left",
              paymentMode === "subscription"
                ? "border-primary/50 bg-primary/10 shadow-[0_0_16px_rgba(139,92,246,0.12)]"
                : "border-white/10 bg-white/5 hover:border-white/20",
            )}
          >
            <div className={cn(
              "mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0",
              paymentMode === "subscription" ? "bg-primary/20 text-primary" : "bg-white/10 text-muted-foreground",
            )}>
              <RefreshCw className="h-4 w-4" />
            </div>
            <div>
              <p className={cn("text-sm font-semibold", paymentMode === "subscription" ? "text-white" : "text-muted-foreground")}>
                Cartão de crédito
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Cobrança automática · sem precisar renovar</p>
            </div>
            {paymentMode === "subscription" && (
              <div className="ml-auto flex-shrink-0">
                <div className="h-4 w-4 rounded-full border-2 border-primary bg-primary/80 flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                </div>
              </div>
            )}
          </button>

          <button
            type="button"
            onClick={() => setPaymentMode("payment")}
            className={cn(
              "flex-1 flex items-start gap-3 p-4 rounded-xl border transition-all text-left",
              paymentMode === "payment"
                ? "border-amber-500/50 bg-amber-500/10 shadow-[0_0_16px_rgba(245,158,11,0.10)]"
                : "border-white/10 bg-white/5 hover:border-white/20",
            )}
          >
            <div className={cn(
              "mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0",
              paymentMode === "payment" ? "bg-amber-500/20 text-amber-400" : "bg-white/10 text-muted-foreground",
            )}>
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <p className={cn("text-sm font-semibold", paymentMode === "payment" ? "text-white" : "text-muted-foreground")}>
                PIX · Boleto · Cartão avulso
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Pague uma vez · renove manualmente ao vencer</p>
            </div>
            {paymentMode === "payment" && (
              <div className="ml-auto flex-shrink-0">
                <div className="h-4 w-4 rounded-full border-2 border-amber-400 bg-amber-400/80 flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                </div>
              </div>
            )}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
                  "transition-all duration-200",
                  isCurrent ? "border-primary/40 shadow-[0_0_20px_rgba(139,92,246,0.12)]"
                  : isScheduled ? "border-amber-500/40 shadow-[0_0_20px_rgba(245,158,11,0.10)]"
                  : "hover:border-white/20",
                )}
              >
                <CardContent className="p-6 flex flex-col h-full">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-display font-semibold text-white">{plan.name}</h4>
                    {isCurrent && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/15 px-2 py-0.5 rounded-full">
                        Atual
                      </span>
                    )}
                    {isScheduled && !isCurrent && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-amber-500/15 px-2 py-0.5 rounded-full">
                        Agendado
                      </span>
                    )}
                  </div>
                  <div className="mb-1">
                    <span className="text-2xl font-bold text-white">{formatBrl(periodPrice)}</span>
                    <span className="text-sm text-muted-foreground">{INTERVAL_SUFFIX[interval]}</span>
                  </div>
                  <div className="mb-4 h-5">
                    {interval !== "month" ? (
                      <span className="text-xs text-emerald-400">
                        equivale a {formatBrl(equivalentMonthly)}/mês
                        {price?.discountPct ? ` · economize ${price.discountPct}%` : ""}
                      </span>
                    ) : null}
                  </div>
                  <ul className="space-y-2 mb-6 flex-1">
                    <li className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-emerald-400 flex-shrink-0" /> Até {plan.petLimit} pets
                    </li>
                    {plan.description && (
                      <li className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Check className="h-4 w-4 text-emerald-400 flex-shrink-0" /> {plan.description}
                      </li>
                    )}
                  </ul>
                  <Button
                    className="w-full"
                    variant={isCurrent ? "ghost" : "default"}
                    disabled={!isAdmin || isCurrent || !isAvailable}
                    isLoading={
                      checkoutMutation.isPending && (checkoutMutation.variables?.data as any)?.planId === plan.id
                    }
                    onClick={() => {
                      if (hasActiveSavedCard) {
                        setPendingPlanId(plan.id);
                      } else {
                        handleCheckout(plan.id);
                      }
                    }}
                  >
                    {buttonLabel}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

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
                  <span className="font-medium text-white capitalize">{savedCard.brand}</span>{" "}
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
            <AlertDialogCancel onClick={() => setPendingPlanId(null)}>Cancelar</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const id = pendingPlanId!;
                setPendingPlanId(null);
                handleCheckout(id, true);
              }}
            >
              Usar outro cartão
            </Button>
            <AlertDialogAction
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
    </div>
  );
}
