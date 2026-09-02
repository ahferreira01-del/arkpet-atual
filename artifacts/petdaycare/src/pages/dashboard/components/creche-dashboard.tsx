import React, { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { todayBrazil } from "@/lib/date-utils";
import { FeedPage } from "@/features/feed/components/FeedPage";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StatCard } from "./stat-card";
import {
  QrCode,
  Receipt,
  ArrowRight,
  Dog,
  Calendar,
  CheckSquare,
  Users,
} from "lucide-react";
import {
  useGetCrecheStats,
  useListPets,
  useListBookings,
  useListTasks,
  useListCrecheStaff,
  getGetCrecheStatsQueryKey,
  getListPetsQueryKey,
  getListBookingsQueryKey,
  getListTasksQueryKey,
  ListTasksStatus,
} from "@workspace/api-client-react";

export function CrecheDashboard({ crecheId, user }: { crecheId: number; user: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  useEffect(() => {
    const id = setInterval(() => {
      if (crecheId) {
        queryClient.invalidateQueries({ queryKey: getGetCrecheStatsQueryKey(crecheId) });
        queryClient.invalidateQueries({ queryKey: getListPetsQueryKey(crecheId) });
        queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey(crecheId) });
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
      }
    }, 20_000);
    return () => clearInterval(id);
  }, [queryClient, crecheId]);

  const { data: stats } = useGetCrecheStats(crecheId);
  const { data: pets, isLoading: petsLoading } = useListPets(crecheId);
  const { data: bookings } = useListBookings(crecheId);
  const { data: tasks } = useListTasks(crecheId, { status: "pending" as ListTasksStatus, date: todayBrazil() });
  const { data: staff } = useListCrecheStaff(crecheId);

  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  const { data: awaitingReceiptsData, isSuccess: awaitingSuccess } = useQuery({
    queryKey: ["financial-awaiting-count", crecheId],
    queryFn: async () => {
      if (!crecheId) return { count: 0 };
      const r = await fetch(
        `/api/creches/${crecheId}/financial/invoices/awaiting-count`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) throw new Error("Falha ao buscar comprovantes pendentes");
      return r.json();
    },
    enabled: Boolean(crecheId && user?.role === "creche_admin"),
    refetchInterval: 30_000,
    staleTime: 0,
  });
  const awaitingCount = awaitingSuccess && typeof awaitingReceiptsData?.count === "number" ? awaitingReceiptsData.count : 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const firstName = user?.name?.split(" ")[0] || "Admin";

  const petsArray = Array.isArray(pets) ? pets : (pets as any)?.items || [];
  const bookingsArray = Array.isArray(bookings) ? bookings : (bookings as any)?.items || [];

  const checkedIn = petsArray.filter((p: any) => p.isCheckedIn) || [];
  const checkedInIds = new Set(checkedIn.map((p: any) => p.id).filter((id: any): id is number => id != null));
  const pendingBookings = bookingsArray.filter((b: any) => b.status === "pending") || [];
  const activeTasks = (tasks || []).filter((t: any) => t.petId != null && checkedInIds.has(t.petId));
  const staffCount = (staff || []).filter((s: any) => s.isActive !== false).length;

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">{greeting}, {firstName}!</h1>
          <p className="text-muted-foreground mt-1">Veja o que está acontecendo na sua creche hoje.</p>
        </div>
        <Link href="/staff/qr-scanner">
          <Button variant="outline" className="gap-2 w-full sm:w-auto min-h-[44px]">
            <QrCode className="h-4 w-4" /> Check-in QR
          </Button>
        </Link>
      </div>

      {/* Financial attention alert */}
      {awaitingCount > 0 && (
        <Link href="/financial?tab=receipts" className="block">
          <div
            role="alert"
            className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-4 cursor-pointer hover:bg-amber-500/15 transition-colors shadow-sm"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
                <Receipt className="h-5 w-5 text-amber-500 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {awaitingCount === 1
                    ? "1 comprovante aguardando validação"
                    : `${awaitingCount} comprovantes aguardando validação`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Clique para revisar e dar baixa nas faturas PIX
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium shrink-0">
              <span>Revisar</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </div>
          </div>
        </Link>
      )}

      <div className="mt-4 sm:mt-6">
        <Tabs 
          defaultTab="timeline"
          tabs={[
            {
              id: "timeline",
              label: "Timeline",
              content: <FeedPage crecheId={crecheId} userRole={user?.role ?? ""} userId={user?.id ?? 0} />
            },
            {
              id: "dashboard",
              label: "Visão Geral",
              content: (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mt-2">
                  <Link href="/pets?filter=present">
                    <StatCard
                      title="Pets Presentes"
                      value={checkedIn.length.toString()}
                      subValue={`de ${pets?.total || 0} cadastrados`}
                      icon={<Dog className="h-5 w-5" />}
                      iconBg="bg-primary/20"
                      iconColor="text-primary"
                      clickable
                    />
                  </Link>
                  <Link href="/bookings?status=pending">
                    <StatCard
                      title="Reservas Pendentes"
                      value={stats?.pendingBookings?.toString() ?? pendingBookings.length.toString()}
                      subValue="aguardando confirmação"
                      icon={<Calendar className="h-5 w-5" />}
                      iconBg={pendingBookings.length > 0 ? "bg-amber-400/20" : "bg-blue-500/20"}
                      iconColor={pendingBookings.length > 0 ? "text-amber-500 dark:text-amber-400" : "text-blue-600 dark:text-blue-400"}
                      alert={pendingBookings.length > 0}
                      clickable
                    />
                  </Link>
                  <Link href="/staff?filter=present">
                    <StatCard
                      title="Tarefas Pendentes"
                      value={activeTasks.length.toString()}
                      subValue="para hoje"
                      icon={<CheckSquare className="h-5 w-5" />}
                      iconBg={activeTasks.length > 0 ? "bg-red-500/20" : "bg-emerald-500/20"}
                      iconColor={activeTasks.length > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}
                      clickable
                    />
                  </Link>
                  <Link href="/staff/manage">
                    <StatCard
                      title="Equipe Ativa"
                      value={staffCount.toString()}
                      subValue="membros"
                      icon={<Users className="h-5 w-5" />}
                      iconBg="bg-violet-500/20"
                      iconColor="text-violet-600 dark:text-violet-400"
                      clickable
                    />
                  </Link>
                </div>
              )
            }
          ]}
        />
      </div>
    </div>
  );
}
