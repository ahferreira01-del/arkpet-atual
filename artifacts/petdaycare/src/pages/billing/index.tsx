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
import { CreditCard, Check, Sparkles, ExternalLink, ShieldCheck, RefreshCw, Zap, CalendarClock, X, Dog, QrCode, FileText } from "lucide-react";
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
  trial: { label: "Período de teste", className: "bg-blue-500/15 text-blue-500 border-blue-500/25" },
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
        onError: (err: Error) => {
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
  const paidPlans = (plans ?? []).filter((p) => p.priceBrl > 0);

  const discountByInterval = new Map<string, number>();
  for (const plan of paidPlans) {
    for (const price of plan.prices ?? []) {
      if (price.discountPct > 0) discountByInterval.set(price.interval, price.discountPct);
    }
  }

  const currentInterval = subscription?.billingInterval as Interval | null | undefined;

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
              <div className="flex items-center gap-2">
                <span className={cn("text-[11px] font-semibold px-2.5 py-0.5 rounded-full border", statusInfo.className)}>
                  • {statusInfo.label}
                </span>
              </div>
              <h2 className="text-xl font-display font-bold text-foreground flex items-center flex-wrap gap-2">
                {subscription?.plan?.name ?? "Plano gratuito"}
                <span className="text-[13px] font-medium text-muted-foreground font-sans">
                  · até {subscription?.plan?.petLimit ?? 0} pets
                </span>
              </h2>
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

      {!isAdmin && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-sm text-blue-500 font-medium">
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
                        className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white border-0 h-12 rounded-xl text-[15px] font-bold"
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
    </div>
  );
}
