import React, { ReactNode } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useGetBillingSubscription } from "@workspace/api-client-react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { BottomNav } from "./bottom-nav";
import { SubscriptionBanner } from "./subscription-banner";
import { Loader2, PhoneCall, Settings } from "lucide-react";

// Routes accessible even when subscription is blocked — needed to authenticate,
// view plans, complete payment, and log out. Keep this list minimal.
const RECOVERY_PATHS = [
  "/assinatura",
  "/settings",
  "/login",
  "/cadastro",
  "/recuperar-senha",
  "/redefinir-senha",
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  const isOperationalRole = user?.role === "creche_admin" || user?.role === "staff";
  const isTutor = user?.role === "tutor";
  const needsSubscriptionCheck = isOperationalRole || isTutor;
  const isOnRecoveryRoute = RECOVERY_PATHS.some((p) => location.startsWith(p));

  // Subscription state — queried for operational roles and tutors.
  const {
    data: subscription,
    isLoading: subLoading,
    isError: subError,
    refetch: refetchSub,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } = useGetBillingSubscription({ query: { enabled: needsSubscriptionCheck } as any });

  const isExpiredTrial =
    subscription?.status === "trial" &&
    !!(subscription as any)?.trialEndsAt &&
    new Date((subscription as any).trialEndsAt) < new Date();

  const isSubscriptionBlocked =
    isExpiredTrial ||
    subscription?.status === "suspended" ||
    subscription?.status === "cancelled";

  // UX redirect: only for operational roles — tutors see an in-place message instead.
  React.useEffect(() => {
    if (!isOperationalRole || isOnRecoveryRoute || subLoading) return;
    if (isSubscriptionBlocked) setLocation("/assinatura");
  }, [isSubscriptionBlocked, isOperationalRole, isOnRecoveryRoute, subLoading, setLocation]);

  // Auth loading / unauthenticated redirect.
  React.useEffect(() => {
    if (!isLoading && !user) setLocation("/login");
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center flex flex-col items-center">
          <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
          <h2 className="text-xl font-display text-white">Carregando ArkPet...</h2>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // ── Subscription gate — operational roles + tutors, non-recovery routes ─────
  if (needsSubscriptionCheck && !isOnRecoveryRoute) {
    // Initial load: fail-closed — do not render the app before knowing subscription status.
    if (subLoading && !subscription) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center flex flex-col items-center">
            <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
            <h2 className="text-xl font-display text-white">Verificando assinatura...</h2>
          </div>
        </div>
      );
    }

    // API error: fail-closed — do not silently grant access if subscription
    // state cannot be determined. Backend will still enforce on every API call.
    if (subError) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center flex flex-col items-center gap-3">
            <p className="text-muted-foreground text-sm">
              Não foi possível verificar o acesso.
            </p>
            <button
              className="text-primary text-sm underline"
              onClick={() => refetchSub()}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }

    if (isSubscriptionBlocked) {
      if (isTutor) {
        // Tutors see a neutral "contact the daycare" screen — no mention of payment.
        return (
          <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
            <div className="flex flex-col items-center gap-6 max-w-sm text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <PhoneCall className="h-8 w-8 text-primary" />
              </div>
              <div className="flex flex-col gap-2">
                <h2 className="text-xl font-display font-semibold text-foreground">
                  Acesso temporariamente indisponível
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Entre em contato com a creche para verificar o seu acesso.
                </p>
              </div>
              <Link href="/settings">
                <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <Settings className="h-4 w-4" />
                  Configurações
                </button>
              </Link>
            </div>
          </div>
        );
      }
      // Operational roles: render nothing while the useEffect redirect fires.
      return null;
    }
  }

  const hideBottomNav = location.startsWith("/bookings/new") || location.startsWith("/staff/qr-scanner");

  return (
    <div className="flex min-h-dvh bg-background overflow-hidden relative">
      {/* Background limpo e sólido. Removidos painéis difusos por restrição de ruído visual. */}

      {/* Desktop sidebar */}
      <Sidebar user={user} />

      {/* h-dvh so the content column fills the real visual viewport on mobile
          (100vh can be wrong when the browser toolbar is visible) */}
      <div className="flex-1 flex flex-col h-dvh overflow-hidden relative z-0">
        <Header user={user} />
        {(user.role === "creche_admin" || user.role === "staff") && <SubscriptionBanner />}
        {/* Use pt/px (no pb shorthand from p-4) so padding-bottom is
            controlled exclusively by the spacer div below.               */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden overscroll-none custom-scrollbar pt-4 px-4 md:pt-6 md:px-6 lg:pt-8 lg:px-8 md:pb-6">
          <div className="max-w-7xl mx-auto">
            {children}
            {/* Physical bottom spacer — visible only on mobile.
                A real element is more reliable than padding-bottom on
                overflow-y:auto in Safari (known Safari bug).
                Height = nav bar (~68 px) + safe-area-inset-bottom.        */}
            {!hideBottomNav && (
              <div
                className="block md:hidden flex-shrink-0"
                aria-hidden="true"
                style={{ height: "calc(72px + env(safe-area-inset-bottom, 0px))" }}
              />
            )}
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      {!hideBottomNav && <BottomNav user={user} />}
    </div>
  );
}
