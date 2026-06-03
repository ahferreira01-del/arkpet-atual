import { useLocation } from "wouter";
import { useGetBillingSubscription } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, CreditCard } from "lucide-react";

type BannerStatus = "past_due" | "suspended" | "cancelled";

const CONFIG: Record<BannerStatus, { message: string; className: string }> = {
  past_due: {
    message: "Há um pagamento pendente na assinatura da creche. Regularize para evitar a suspensão dos serviços.",
    className: "bg-amber-500/10 border-amber-500/25 text-amber-200",
  },
  suspended: {
    message: "A assinatura da creche está suspensa. Novos cadastros e reservas estão bloqueados até a regularização.",
    className: "bg-red-500/10 border-red-500/25 text-red-200",
  },
  cancelled: {
    message: "A assinatura da creche foi cancelada. Reative um plano para voltar a usar todos os recursos.",
    className: "bg-red-500/10 border-red-500/25 text-red-200",
  },
};

// Only mounted for creche_admin / staff (see AppLayout), so the query never runs
// for tutors or master_admin.
export function SubscriptionBanner() {
  const { user } = useAuth();
  const [location, navigate] = useLocation();

  const { data } = useGetBillingSubscription();

  if (!data) return null;
  if (location.includes("/assinatura")) return null;

  const status = data.status as string;
  if (status !== "past_due" && status !== "suspended" && status !== "cancelled") return null;

  const config = CONFIG[status as BannerStatus];
  const isAdmin = user?.role === "creche_admin";

  return (
    <div className={cn("flex items-center gap-3 px-4 py-2.5 border-b text-sm", config.className)}>
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      <p className="flex-1 leading-snug">{config.message}</p>
      {isAdmin && (
        <Button
          size="sm"
          variant="ghost"
          className="flex-shrink-0 h-8"
          onClick={() => navigate("/assinatura")}
        >
          <CreditCard className="mr-1.5 h-4 w-4" /> Regularizar
        </Button>
      )}
    </div>
  );
}
