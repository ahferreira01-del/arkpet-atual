import React, { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  useListTasks,
  useListPets,
  useGetCrecheStats,
  useListBookings,
  useListCreches,
  useListWalks,
  useListCrecheStaff,
  useUpdateBooking,
  useCompleteTask,
  useListUsers,
  getGetCrecheStatsQueryKey,
  getListPetsQueryKey,
  getListBookingsQueryKey,
  getListTasksQueryKey,
  getListCrecheStaffQueryKey,
  ListTasksStatus,
} from "@workspace/api-client-react";
import { FeedPage } from "@/features/feed/components/FeedPage";
import { buildMediaSrc, getMediaToken } from "@/features/feed/utils/media.utils";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  CheckSquare,
  Dog,
  TrendingUp,
  Calendar,
  AlertCircle,
  Building2,
  Users,
  Clock,
  MessageSquare,
  Footprints,
  BarChart2,
  Activity,
  Shield,
  Bell,
  Database,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Sparkles,
  QrCode,
  ChevronRight,
  UserCheck,
  LogIn,
  LogOut,
  UtensilsCrossed,
  Pill,
  Camera,
  Video,
  FileText,
  Heart,
  Gamepad2,
  RefreshCw,
  Receipt,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { parseUTC, todayBrazil, parseLocalDate } from "@/lib/date-utils";
import { resolvePhotoUrl } from "@/lib/utils";
import { usePush } from "@/hooks/use-push";
import { useUpcomingInvoices } from "@/hooks/use-financial";

// ─── Componente de Prompt de Notificação ──────────────────────────────────────
function NotificationPrompt() {
  const { isSupported, permission, isSubscribed, isLoading, subscribe } = usePush();
  const [dismissed, setDismissed] = useState(false);

  if (!isSupported || permission !== "default" || isSubscribed || dismissed) {
    return null;
  }

  return (
    <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-start sm:items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0 mt-1 sm:mt-0">
          <Bell className="h-5 w-5 text-primary animate-pulse" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-white">Ative as Notificações</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">Receba alertas de reservas, check-in e mensagens em tempo real.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-white">
          Agora não
        </Button>
        <Button size="sm" onClick={subscribe} isLoading={isLoading} className="bg-primary hover:bg-primary/90 text-white">
          Ativar
        </Button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;
  if (!user) return null;
  if (user.role === "staff") return <StaffDashboard user={user} />;
  if (user.role === "master_admin") return <MasterAdminDashboard />;
  if (user.role === "tutor") return <TutorDashboard user={user} />;
  if (!user.crecheId) return <div className="p-8 text-center text-muted-foreground">Nenhuma creche vinculada</div>;
  return <CrecheDashboard crecheId={user.crecheId} user={user} />;
}

// ─── Creche Admin ──────────────────────────────────────────────────────────────
function CrecheDashboard({ crecheId, user }: { crecheId: number; user: any }) {
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

// ─── Staff ────────────────────────────────────────────────────────────────────
function StaffDashboard({ user }: { user: any }) {
  const crecheId = user?.crecheId ?? null;
  const queryClient = useQueryClient();
  const { data: tasks, isLoading } = useListTasks(crecheId ?? 0, { status: "pending" as ListTasksStatus });
  const { data: pets } = useListPets(crecheId ?? 0);

  useEffect(() => {
    const id = setInterval(() => {
      if (crecheId) {
        queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
        queryClient.invalidateQueries({ queryKey: getListPetsQueryKey(crecheId) });
      }
    }, 20_000);
    return () => clearInterval(id);
  }, [queryClient, crecheId]);
  const petsArray = Array.isArray(pets) ? pets : (pets as any)?.items || [];
  const checkedIn = petsArray.filter((p: any) => p.isCheckedIn) || [];
  const checkedInIds = new Set(checkedIn.map((p: any) => p.id).filter((id: any): id is number => id != null));
  const activeTasks = (tasks || []).filter((t: any) => t.petId != null && checkedInIds.has(t.petId));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">{greeting}, {user.name.split(" ")[0]}!</h1>
          <p className="text-muted-foreground mt-1">{format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{checkedIn.length} presente{checkedIn.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Link href="/staff">
          <div className="bg-card border border-border p-3 sm:p-4 rounded-2xl sm:rounded-3xl hover:bg-secondary transition-all cursor-pointer flex flex-col items-center gap-2 text-center min-h-[44px] shadow-sm">
            <div className="h-10 w-10 rounded-2xl bg-amber-400/20 flex items-center justify-center shrink-0">
              <CheckSquare className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-foreground">Tarefas</p>
            {activeTasks.length > 0 && (
              <Badge variant="warning" className="text-[10px] sm:text-xs px-1.5 py-0">{activeTasks.length}</Badge>
            )}
          </div>
        </Link>
        <Link href="/walks">
          <div className="bg-card border border-border p-3 sm:p-4 rounded-2xl sm:rounded-3xl hover:bg-secondary transition-all cursor-pointer flex flex-col items-center gap-2 text-center min-h-[44px] shadow-sm">
            <div className="h-10 w-10 rounded-2xl bg-emerald-500/20 flex items-center justify-center shrink-0">
              <Footprints className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-foreground">Passeios</p>
          </div>
        </Link>
        <Link href="/pets">
          <div className="bg-card border border-border p-3 sm:p-4 rounded-2xl sm:rounded-3xl hover:bg-secondary transition-all cursor-pointer flex flex-col items-center gap-2 text-center min-h-[44px] shadow-sm">
            <div className="h-10 w-10 rounded-2xl bg-primary/20 flex items-center justify-center shrink-0">
              <Dog className="h-5 w-5 text-primary" />
            </div>
            <p className="text-xs sm:text-sm font-semibold text-foreground">Pets</p>
          </div>
        </Link>
      </div>

      <Tabs
        defaultTab="timeline"
        tabs={[
          {
            id: "timeline",
            label: "Timeline",
            content: <FeedPage crecheId={crecheId} userRole={user?.role ?? ""} userId={user?.id ?? 0} />,
          },
          {
            id: "tasks",
            label: "Tarefas",
            content: (
              <Card className="border-border bg-card shadow-sm">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-base sm:text-lg font-display font-semibold flex items-center gap-2 text-foreground">
                      <Clock className="h-5 w-5 text-amber-500 dark:text-amber-400" /> Próximas Tarefas
                    </h2>
                    <Link href="/staff">
                      <button className="text-sm font-medium text-primary hover:text-primary/80 transition-colors min-h-[44px] px-2 -mr-2">Ver todas →</button>
                    </Link>
                  </div>
                  {isLoading ? (
                    <div className="text-center py-4 text-muted-foreground">Carregando...</div>
                  ) : activeTasks.length ? (
                    <div className="space-y-2.5">
                      {activeTasks.slice(0, 6).map((task) => (
                        <Link key={task.id} href="/staff">
                          <div className="flex items-center justify-between p-3.5 rounded-xl bg-secondary/30 border border-border hover:bg-secondary hover:border-border transition-all cursor-pointer group min-h-[44px]">
                            <div className="min-w-0 pr-3">
                              <p className="font-medium text-foreground text-sm min-w-0 break-words">{task.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 min-w-0 break-words">
                                {task.petName && <span className="text-primary mr-2 font-medium">{task.petName}</span>}
                                {format(new Date(task.scheduledFor), "HH:mm")}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge variant={task.priority === "high" ? "destructive" : "secondary"} className="text-xs">
                                {task.priority === "high" ? "Alta" : task.priority === "medium" ? "Média" : "Baixa"}
                              </Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon={CheckCircle2} title="Tudo em dia!" description="Sem tarefas pendentes." />
                  )}
                </CardContent>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
}

// ─── Tutor ────────────────────────────────────────────────────────────────────

type TutorTimelineEvent = {
  id: number;
  petId: number;
  petName: string;
  petPhotoUrl: string | null;
  authorName: string | null;
  type: string;
  content: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  createdAt: string;
  likeCount: number;
  isLikedByUser: boolean;
};

function useTutorTimeline(crecheId: number, tutorId: number) {
  return useQuery<TutorTimelineEvent[]>({
    queryKey: ["tutor-timeline", crecheId, tutorId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(
        `/api/creches/${crecheId}/tutor-timeline?tutorId=${tutorId}&limit=50`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) throw new Error("Erro ao carregar timeline");
      return r.json();
    },
    enabled: !!crecheId && !!tutorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}



const eventConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  check_in:   { icon: <LogIn className="h-3.5 w-3.5" />,         label: "Check-in",    color: "text-emerald-400 bg-emerald-500/15 border-emerald-500/25" },
  check_out:  { icon: <LogOut className="h-3.5 w-3.5" />,        label: "Check-out",   color: "text-amber-400 bg-amber-500/15 border-amber-500/25" },
  feeding:    { icon: <UtensilsCrossed className="h-3.5 w-3.5" />, label: "Alimentação", color: "text-orange-400 bg-orange-500/15 border-orange-500/25" },
  medication: { icon: <Pill className="h-3.5 w-3.5" />,          label: "Medicação",   color: "text-red-400 bg-red-500/15 border-red-500/25" },
  walk:       { icon: <Footprints className="h-3.5 w-3.5" />,    label: "Passeio",     color: "text-violet-400 bg-violet-500/15 border-violet-500/25" },
  play:       { icon: <Gamepad2 className="h-3.5 w-3.5" />,      label: "Brincadeira", color: "text-pink-400 bg-pink-500/15 border-pink-500/25" },
  photo:      { icon: <Camera className="h-3.5 w-3.5" />,        label: "Foto",        color: "text-sky-400 bg-sky-500/15 border-sky-500/25" },
  video:      { icon: <Video className="h-3.5 w-3.5" />,         label: "Vídeo",       color: "text-blue-400 bg-blue-500/15 border-blue-500/25" },
  note:       { icon: <FileText className="h-3.5 w-3.5" />,      label: "Anotação",    color: "text-slate-300 bg-slate-500/15 border-slate-500/25" },
  health:     { icon: <Heart className="h-3.5 w-3.5" />,         label: "Saúde",       color: "text-rose-400 bg-rose-500/15 border-rose-500/25" },
};

function TimelineEventCard({
  ev,
  crecheId,
  onLike,
}: {
  ev: any;
  crecheId: number;
  onLike: () => void;
}) {
  const cfg = eventConfig[ev.type] ?? {
    icon: <Sparkles className="h-3.5 w-3.5" />,
    label: ev.type,
    color: "text-muted-foreground bg-secondary border-border",
  };

  const [loadedMedia, setLoadedMedia] = React.useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = React.useState(false);
  const rawMedia = ev.mediaUrl || loadedMedia;
  // Convert raw media path to an authenticated displayable URL.
  // /objects/...      → build authenticated storage URL (new object-storage posts)
  // /api/storage/...  → append ?mt= media token (lazy-loaded detail response)
  // data:... / other  → use directly (base64 or blob)
  const displayMedia = (() => {
    if (!rawMedia) return null;
    if (rawMedia.startsWith("/objects/")) {
      return buildMediaSrc(rawMedia, getMediaToken());
    }
    const mt = localStorage.getItem("media_token") || "";
    if (rawMedia.startsWith("/api/storage") && mt) {
      return `${rawMedia}${rawMedia.includes("?") ? "&" : "?"}mt=${encodeURIComponent(mt)}`;
    }
    return rawMedia; // base64 / blob
  })();
  const hasMedia = ev.hasMedia ?? !!ev.mediaUrl;

  const handleLoadMedia = React.useCallback(async () => {
    if (mediaLoading || loadedMedia) return;
    setMediaLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/feed/${ev.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const url: string | undefined = data.mediaUrl;
        if (!url) return;
        // V2 objectPaths start with "/objects/" — convert to authenticated storage URL
        if (url.startsWith("/objects/")) {
          setLoadedMedia(buildMediaSrc(url, getMediaToken()));
        } else {
          setLoadedMedia(url);
        }
      }
    } catch {
      // silent
    } finally {
      setMediaLoading(false);
    }
  }, [crecheId, ev.id, loadedMedia, mediaLoading]);

  // Auto-load media on mount
  React.useEffect(() => {
    if (hasMedia && !ev.mediaUrl && !loadedMedia) {
      handleLoadMedia();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-card border rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-start sm:items-center gap-3 px-4 pt-4 pb-3">
        <div className="h-10 w-10 rounded-full overflow-hidden bg-secondary flex-shrink-0 relative">
          {ev.petPhotoUrl ? (
            <img
              src={
                ev.petPhotoUrl.startsWith("/objects/")
                  ? buildMediaSrc(ev.petPhotoUrl, getMediaToken())
                  : ev.petPhotoUrl
              }
              alt={ev.petName}
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty("display", "flex");
              }}
            />
          ) : null}
          <div
            className="h-full w-full items-center justify-center absolute inset-0"
            style={{ display: ev.petPhotoUrl ? "none" : "flex" }}
          >
            <Dog className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <p className="text-sm font-semibold text-foreground leading-tight">{ev.petName}</p>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium flex-shrink-0 ${cfg.color}`}>
              {cfg.icon} {cfg.label}
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-muted-foreground">
            {ev.authorName ? `${ev.authorName} · ` : ""}
            {format(parseUTC(ev.createdAt), "dd/MM · HH:mm", { locale: ptBR })}
          </p>
        </div>
      </div>

      {/* Text */}
      {ev.content && (
        <p className="text-sm text-foreground px-4 pb-4 leading-relaxed">{ev.content}</p>
      )}

      {/* Loading placeholder while media fetches automatically */}
      {hasMedia && !displayMedia && (
        <div className="mx-4 mb-4 flex items-center justify-center gap-2 py-6 rounded-xl bg-secondary border border-border text-sm text-muted-foreground animate-pulse">
          <Camera className="h-4 w-4" />
          Carregando foto...
        </div>
      )}

      {/* Media */}
      {displayMedia && ev.mediaType === "photo" && (
        <img src={displayMedia} alt="foto" className="w-full object-cover max-h-80" loading="lazy" />
      )}
      {displayMedia && ev.mediaType === "video" && (
        <video src={displayMedia} controls className="w-full max-h-64" />
      )}

      {/* Like */}
      <div className="px-2 py-1.5 border-t border-border">
        <button
          onClick={onLike}
          className={`flex items-center justify-center sm:justify-start gap-2 w-full sm:w-auto text-sm transition-colors py-2.5 px-3 min-h-[44px] rounded-lg hover:bg-secondary ${
            ev.isLikedByUser ? "text-primary font-medium" : "text-muted-foreground hover:text-primary"
          }`}
        >
          <Heart className={`h-4 w-4 ${ev.isLikedByUser ? "fill-primary text-primary" : ""}`} />
          {ev.likeCount > 0 && <span>{ev.likeCount}</span>}
          <span>{ev.isLikedByUser ? "Curtido" : "Curtir"}</span>
        </button>
      </div>
    </div>
  );
}

function TutorDashboard({ user }: { user: any }) {
  const crecheId = user?.crecheId ?? null;
  const queryClient = useQueryClient();
  const { data: pets } = useListPets(crecheId ?? 0);
  const { data: timeline, isLoading: timelineLoading, isError: timelineError, refetch } = useTutorTimeline(crecheId ?? 0, user?.id ?? 0);
  const { data: invoices, isLoading: invoicesLoading } = useUpcomingInvoices(crecheId ?? 0, user?.id ?? 0);

  const myPets = Array.isArray(pets) ? pets : (pets as any)?.items || [];
  const checkedInPets = myPets.filter((p: any) => p.isCheckedIn);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
  const events = timeline || [];

  const handleLike = async (ev: TutorTimelineEvent) => {
    if (!crecheId) return;
    const token = localStorage.getItem("auth_token");
    // Timeline events are stored in timeline_events — use the feed like endpoint
    await fetch(
      `/api/creches/${crecheId}/feed/${ev.id}/like`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } }
    );
    queryClient.invalidateQueries({ queryKey: ["tutor-timeline", crecheId, user.id] });
  };

  const invoiceList = invoices?.data || (Array.isArray(invoices) ? invoices : []);
  const pendingOrOverdue = invoiceList.filter((inv: any) => inv.status === "pending" || inv.status === "overdue");
  const overdueInvoices = pendingOrOverdue.filter((inv: any) => {
    if (inv.status === "overdue") return true;
    if (!inv.dueDate) return false;
    const due = new Date(`${inv.dueDate}T00:00:00`);
    const today = new Date(`${todayBrazil()}T00:00:00`);
    return due.getTime() < today.getTime();
  });
  
  const upcomingInvoices = pendingOrOverdue.filter((inv: any) => {
    if (inv.status === "overdue") return false;
    if (!inv.dueDate) return false;
    const due = new Date(`${inv.dueDate}T00:00:00`);
    const today = new Date(`${todayBrazil()}T00:00:00`);
    const diff = due.getTime() - today.getTime();
    const diffDays = Math.round(diff / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 5;
  });

  // Days until the nearest upcoming invoice (for dynamic badge copy)
  const minDaysUntilDue = upcomingInvoices.reduce((min: number, inv: any) => {
    const diff = new Date(`${inv.dueDate}T00:00:00`).getTime() - new Date(`${todayBrazil()}T00:00:00`).getTime();
    const d = Math.round(diff / (1000 * 60 * 60 * 24));
    return d < min ? d : min;
  }, Infinity);
  const dueBadge = minDaysUntilDue === 0 ? "vence hoje" : minDaysUntilDue === 1 ? "vence em 1 dia" : `vence em ${minDaysUntilDue} dias`;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">
      <NotificationPrompt />

      {/* ── Avisos Financeiros ── */}
      {invoicesLoading && (
        <div className="mb-4 p-4 rounded-2xl bg-secondary border border-border animate-pulse h-16" />
      )}
      {!invoicesLoading && overdueInvoices.length > 0 && (
        <div className="mb-4 p-4 rounded-2xl bg-destructive/10 border border-destructive/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-destructive/20 flex items-center justify-center shrink-0">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-destructive">Faturas Atrasadas</h3>
              <p className="text-xs text-foreground mt-0.5 leading-relaxed">Você possui faturas em atraso. Regularize para continuar agendando.</p>
            </div>
          </div>
          <Link href="/tutor/financial" className="w-full sm:w-auto">
            <Button size="sm" variant="destructive" className="w-full sm:w-auto min-h-[44px]">Regularizar</Button>
          </Link>
        </div>
      )}
      {!invoicesLoading && overdueInvoices.length === 0 && upcomingInvoices.length > 0 && (
        <div className="mb-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0">
              <AlertCircle className="h-5 w-5 text-amber-500" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-500">Fatura Próxima do Vencimento</h3>
              <p className="text-xs text-foreground mt-0.5 leading-relaxed">Você possui uma fatura que {dueBadge}.</p>
            </div>
          </div>
          <Link href="/tutor/financial" className="w-full sm:w-auto">
            <Button size="sm" variant="outline" className="w-full sm:w-auto border-amber-500/30 text-amber-600 dark:text-amber-500 hover:bg-amber-500/10 min-h-[44px]">Pagar agora</Button>
          </Link>
        </div>
      )}

      {/* ── Greeting ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">
            {greeting}, {user.name.split(" ")[0]}!
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {myPets.length > 0
              ? `${myPets.length} pet${myPets.length !== 1 ? "s" : ""} cadastrado${myPets.length !== 1 ? "s" : ""}`
              : "Acompanhe seus pets em tempo real."}
          </p>
        </div>
        {checkedInPets.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              {checkedInPets.length} na creche
            </span>
          </div>
        )}
      </div>

      {/* ── Quick actions ── */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <Link href="/pets" className="block">
          <div className="bg-card border rounded-2xl px-2 sm:px-4 py-4 hover:bg-secondary/80 transition-all cursor-pointer flex flex-col items-center gap-2 text-center h-full shadow-sm">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Dog className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs sm:text-sm font-semibold text-foreground">Meus Pets</p>
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">
                {myPets.length} cadastrado{myPets.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </Link>
        <Link href="/bookings" className="block">
          <div className="bg-card border rounded-2xl px-2 sm:px-4 py-4 hover:bg-secondary/80 transition-all cursor-pointer flex flex-col items-center gap-2 text-center h-full shadow-sm">
            <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Calendar className="h-5 w-5 text-blue-500" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs sm:text-sm font-semibold text-foreground">Reservas</p>
            </div>
          </div>
        </Link>
        <Link href="/chat" className="block">
          <div className="bg-card border rounded-2xl px-2 sm:px-4 py-4 hover:bg-secondary/80 transition-all cursor-pointer flex flex-col items-center gap-2 text-center h-full shadow-sm">
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <MessageSquare className="h-5 w-5 text-emerald-500" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs sm:text-sm font-semibold text-foreground">Mensagens</p>
            </div>
          </div>
        </Link>
      </div>

      {/* ── Timeline ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-display font-semibold text-foreground">
            Atividades dos seus pets
          </h2>
          <button
            onClick={() => refetch()}
            className="text-sm font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5 min-h-[44px] px-2"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>

        {/* Loading skeleton */}
        {timelineLoading && (
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card border rounded-2xl p-4 flex gap-3 animate-pulse shadow-sm">
                <div className="h-10 w-10 rounded-full bg-secondary flex-shrink-0" />
                <div className="flex-1 space-y-2 pt-2">
                  <div className="h-3 bg-secondary rounded w-1/3" />
                  <div className="h-3 bg-secondary rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {!timelineLoading && timelineError && (
          <div className="flex flex-col items-center gap-3 py-10 px-4 text-center bg-card border rounded-2xl border-dashed">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <RefreshCw className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Não foi possível carregar as atividades</p>
              <p className="text-sm text-muted-foreground mt-1">Verifique sua conexão e tente novamente.</p>
            </div>
            <Button onClick={() => refetch()} variant="outline" className="mt-2 min-h-[44px]">
              Tentar novamente
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!timelineLoading && !timelineError && events.length === 0 && (
          <EmptyState
            icon={Sparkles}
            title="Nenhuma atividade ainda"
            description="Quando a creche registrar algo sobre seus pets, aparecerá aqui."
            className="py-12 bg-card border rounded-2xl border-dashed"
          />
        )}

        {/* Events */}
        {!timelineLoading && !timelineError && events.length > 0 && (
          <div className="flex flex-col gap-4">
            {events.map((ev) => (
              <TimelineEventCard
                key={`${ev.id}-${ev.petId}`}
                ev={ev}
                crecheId={crecheId}
                onLike={() => handleLike(ev)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Master Admin ─────────────────────────────────────────────────────────────
function MasterAdminDashboard() {
  const { data: creches, isLoading } = useListCreches();
  const { data: allUsers } = useListUsers();
  const [, navigate] = useLocation();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  const activeCreches = creches?.filter((c) => c.status === "active") ?? [];
  const inactiveCreches = creches?.filter((c) => c.status !== "active") ?? [];
  const totalCapacity = activeCreches.reduce((s, c) => s + ((c as any).maxCapacity ?? 0), 0);
  const totalOccupied = activeCreches.reduce((s, c) => s + ((c as any).currentOccupancy ?? 0), 0);
  const avgOccupancy = totalCapacity > 0 ? Math.round((totalOccupied / totalCapacity) * 100) : 0;

  const totalUsers = allUsers?.length ?? 0;
  const totalTutors = allUsers?.filter((u: any) => u.role === "tutor").length ?? 0;
  const totalStaff = allUsers?.filter((u: any) => u.role === "staff" || u.role === "creche_admin").length ?? 0;

  const systemServices = [
    { label: "API & Backend", icon: <Activity className="h-4 w-4" />, status: "online" },
    { label: "Banco de Dados", icon: <Database className="h-4 w-4" />, status: "online" },
    { label: "Notificações Push", icon: <Bell className="h-4 w-4" />, status: "online" },
    { label: "Segurança & Auth", icon: <Shield className="h-4 w-4" />, status: "online" },
  ];

  // Sort by occupancy % desc
  const sortedCreches = [...(creches ?? [])].sort((a, b) => {
    const pctA = (a as any).maxCapacity > 0 ? ((a as any).currentOccupancy / (a as any).maxCapacity) : 0;
    const pctB = (b as any).maxCapacity > 0 ? ((b as any).currentOccupancy / (b as any).maxCapacity) : 0;
    return pctB - pctA;
  });

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground mb-1">
            {format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
          </p>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">{greeting}, Master!</h1>
          <p className="text-muted-foreground mt-1">Visão global de toda a rede ArkPet.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 self-start sm:self-auto">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Rede Operacional</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Link href="/admin?status=active">
          <StatCard
            title="Creches Ativas"
            value={activeCreches.length.toString()}
            subValue={`${inactiveCreches.length} inativas`}
            icon={<Building2 className="h-5 w-5" />}
            iconColor="text-primary"
            iconBg="bg-primary/20"
            clickable
          />
        </Link>
        <StatCard
          title="Ocupação Média"
          value={`${avgOccupancy}%`}
          subValue={`${totalOccupied} pets presentes`}
          icon={<BarChart2 className="h-5 w-5" />}
          iconColor={avgOccupancy > 80 ? "text-amber-500 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}
          iconBg={avgOccupancy > 80 ? "bg-amber-400/20" : "bg-emerald-400/20"}
        />
        <Link href="/admin/users?role=tutor">
          <StatCard
            title="Usuários Totais"
            value={totalUsers.toString()}
            subValue={`${totalTutors} tutores · ${totalStaff} equipe`}
            icon={<Users className="h-5 w-5" />}
            iconColor="text-violet-500 dark:text-violet-400"
            iconBg="bg-violet-400/20"
            clickable
          />
        </Link>
        <StatCard
          title="Pets na Rede"
          value={totalOccupied.toString()}
          subValue={`cap. total: ${totalCapacity}`}
          icon={<Dog className="h-5 w-5" />}
          iconColor="text-blue-500 dark:text-blue-400"
          iconBg="bg-blue-400/20"
        />
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Creches list */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-semibold text-foreground">Creches da Rede</h2>
            <Link href="/admin">
              <Button variant="outline" size="sm" className="gap-1.5 min-h-[44px] sm:min-h-0">
                <Sparkles className="h-3.5 w-3.5" /> Painel Completo
              </Button>
            </Link>
          </div>
          <Card className="shadow-sm">
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">Carregando...</div>
              ) : sortedCreches.length ? (
                <div className="divide-y divide-border">
                  {sortedCreches.map((creche) => {
                    const occ = (creche as any).currentOccupancy ?? 0;
                    const cap = (creche as any).maxCapacity ?? 0;
                    const pct = cap > 0 ? Math.round((occ / cap) * 100) : 0;
                    const isActive = creche.status === "active";
                    const barColor = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-400" : "bg-emerald-400";
                    return (
                      <Link key={creche.id} href="/admin">
                        <div className="p-4 sm:p-5 hover:bg-secondary transition-colors cursor-pointer group min-h-[44px]">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                              <div className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center shrink-0 group-hover:bg-primary/20 dark:group-hover:bg-primary/30 transition-colors">
                                <Building2 className="h-4 w-4 sm:h-5 sm:w-5 text-primary" />
                              </div>
                              <div className="min-w-0 pr-2">
                                <p className="font-semibold text-foreground group-hover:text-primary transition-colors min-w-0 break-words">{creche.name}</p>
                                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                                  {creche.address || "Endereço não informado"}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge variant={isActive ? "success" : "secondary"} className="text-[10px] sm:text-xs">
                                {isActive ? "Ativa" : "Inativa"}
                              </Badge>
                              <ChevronRight className="h-4 w-4 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity hidden sm:block" />
                            </div>
                          </div>
                          {cap > 0 ? (
                            <div className="pl-[52px] sm:pl-[60px]">
                              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                                <span>Ocupação atual</span>
                                <span className="font-medium text-foreground">{occ}/{cap} pets · {pct}%</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          ) : (
                            <div className="pl-[52px] sm:pl-[60px]">
                              <p className="text-xs text-muted-foreground">Capacidade não configurada</p>
                            </div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <EmptyState icon={Building2} title="Nenhuma creche" description="Nenhuma creche cadastrada ainda." className="py-12" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">

          {/* System health */}
          <div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-3">Saúde do Sistema</h2>
            <Card className="shadow-sm">
              <CardContent className="p-4 sm:p-5 space-y-4">
                {systemServices.map(({ label, icon, status }) => (
                  <div key={label} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">{icon}</span>
                      <span className="text-sm text-muted-foreground">{label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${status === "online" ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                      <span className={`text-xs font-semibold ${status === "online" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {status === "online" ? "Online" : "Offline"}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Quick actions */}
          <div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-3">Ações Rápidas</h2>
            <div className="space-y-2">
              {[
                { href: "/admin", icon: <Building2 className="h-4 w-4" />, bg: "bg-primary/10 dark:bg-primary/20", color: "text-primary", label: "Gerenciar Creches", desc: "Editar, adicionar ou desativar" },
                { href: "/admin/users", icon: <Users className="h-4 w-4" />, bg: "bg-blue-500/10 dark:bg-blue-500/20", color: "text-blue-600 dark:text-blue-400", label: "Todos os Usuários", desc: "Gerir contas e permissões" },
              ].map(({ href, icon, bg, color, label, desc }) => (
                <Link key={href} href={href}>
                  <div className="flex items-center gap-3 p-3.5 rounded-xl bg-card hover:bg-secondary border border-border hover:border-border transition-all cursor-pointer group min-h-[44px] shadow-sm">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${bg} ${color}`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground min-w-0 break-words">{label}</p>
                      <p className="text-xs text-muted-foreground truncate">{desc}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-50 group-hover:opacity-100 transition-opacity" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Network summary */}
          <Card className="bg-primary/5 dark:bg-primary/10 border-primary/20 shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-4">Resumo da Rede</p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Total Creches", value: creches?.length ?? 0 },
                  { label: "Ativas", value: activeCreches.length },
                  { label: "Pets Presentes", value: totalOccupied },
                  { label: "Capacidade Total", value: totalCapacity || "—" },
                  { label: "Total Usuários", value: totalUsers },
                  { label: "Tutores", value: totalTutors },
                ].map(({ label, value }) => (
                  <div key={label} className="min-w-0">
                    <p className="text-xl font-display font-bold text-foreground min-w-0 break-words">{value}</p>
                    <p className="text-xs text-muted-foreground truncate">{label}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────
function StatCard({
  title,
  value,
  subValue,
  trend,
  icon,
  iconColor = "text-primary",
  iconBg = "bg-primary/20",
  alert,
  clickable,
}: {
  title: string;
  value: string;
  subValue?: string;
  trend?: string;
  icon: React.ReactNode;
  iconColor?: string;
  iconBg?: string;
  alert?: boolean;
  clickable?: boolean;
}) {
  return (
    <Card className={`relative overflow-hidden transition-all duration-200 shadow-sm bg-card border-border ${
      alert ? "border-amber-400/40 dark:shadow-[0_0_20px_rgba(251,191,36,0.1)] bg-amber-50/50 dark:bg-amber-950/10" : ""
    } ${clickable ? "hover:bg-secondary cursor-pointer min-h-[44px]" : ""}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1 min-w-0 break-words">{title}</p>
            <h3 className="text-2xl lg:text-3xl font-display font-bold text-foreground leading-none min-w-0 break-words">{value}</h3>
            {trend && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2 flex items-center gap-1 truncate">
                <TrendingUp className="h-3 w-3 shrink-0" /> {trend}
              </p>
            )}
            {subValue && !trend && (
              <p className="text-xs text-muted-foreground mt-2 truncate">{subValue}</p>
            )}
          </div>
          <div className={`h-10 w-10 sm:h-11 sm:w-11 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
            {icon}
          </div>
        </div>
        {clickable && (
          <div className="mt-3 flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground/60">
            <ArrowRight className="h-3 w-3 shrink-0" /> <span className="truncate">Ver detalhes</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
