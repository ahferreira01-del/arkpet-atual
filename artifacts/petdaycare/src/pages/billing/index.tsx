import React from "react";
import { useLocation } from "wouter";
import {
  useGetBillingPlans,
  useGetBillingSubscription,
  useCreateBillingCheckout,
  useCreateBillingPortal,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { CreditCard, Check, Sparkles, ExternalLink, ShieldCheck } from "lucide-react";

type Interval = "month" | "quarter" | "semester" | "year";

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

  const { data: plans, isLoading: plansLoading } = useGetBillingPlans();
  const { data: subscription, isLoading: subLoading } = useGetBillingSubscription();

  const checkoutMutation = useCreateBillingCheckout();
  const portalMutation = useCreateBillingPortal();

  React.useEffect(() => {
    if (location.includes("cancelado")) {
      toast({
        title: "Pagamento cancelado",
        description: "Você pode escolher um plano quando quiser.",
      });
    }
  }, [location, toast]);

  const handleCheckout = (planId: number) => {
    checkoutMutation.mutate(
      { data: { planId, interval } },
      {
        onSuccess: (res) => {
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

  // Discount % per interval (uniform across plans) for the period toggle badges.
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
                    ? `Próxima cobrança em ${formatDate(subscription?.currentPeriodEnd)}`
                    : status === "past_due"
                      ? `Pendente desde ${formatDate(subscription?.pastDueSince)}`
                      : ""}
              </p>
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
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Planos disponíveis
          </h3>

          {/* Billing period selector */}
          <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/5 p-1">
            {INTERVALS.map((opt) => {
              const discount = discountByInterval.get(opt);
              const isActive = interval === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setInterval(opt)}
                  className={cn(
                    "relative px-3 py-1.5 text-xs font-medium rounded-lg transition-all",
                    isActive
                      ? "bg-primary text-primary-foreground shadow"
                      : "text-muted-foreground hover:text-white",
                  )}
                >
                  {INTERVAL_LABELS[opt]}
                  {discount ? (
                    <span
                      className={cn(
                        "ml-1.5 text-[10px] font-bold",
                        isActive ? "text-primary-foreground/90" : "text-emerald-400",
                      )}
                    >
                      −{discount}%
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {paidPlans.map((plan) => {
            const isCurrent =
              plan.id === currentPlanId &&
              status === "active" &&
              (currentInterval ?? "month") === interval;

            const price = (plan.prices ?? []).find((p) => p.interval === interval);
            const periodPrice = price?.priceBrl ?? plan.priceBrl * INTERVAL_MONTHS[interval];
            const isAvailable = interval === "month" ? true : price?.available ?? false;
            const equivalentMonthly = Math.round(periodPrice / INTERVAL_MONTHS[interval]);

            return (
              <Card
                key={plan.id}
                className={cn(
                  "transition-all duration-200",
                  isCurrent ? "border-primary/40 shadow-[0_0_20px_rgba(139,92,246,0.12)]" : "hover:border-white/20",
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
                      checkoutMutation.isPending && checkoutMutation.variables?.data.planId === plan.id
                    }
                    onClick={() => handleCheckout(plan.id)}
                  >
                    {isCurrent
                      ? "Plano atual"
                      : !isAvailable
                        ? "Indisponível"
                        : status === "active"
                          ? "Mudar para este plano"
                          : "Assinar"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
