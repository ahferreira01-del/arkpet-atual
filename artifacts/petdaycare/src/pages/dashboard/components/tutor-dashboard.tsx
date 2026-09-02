import React, { useState, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { todayBrazil, parseUTC } from "@/lib/date-utils";
import { buildMediaSrc, getMediaToken } from "@/features/feed/utils/media.utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { usePush } from "@/hooks/use-push";
import { useUpcomingInvoices } from "@/hooks/use-financial";
import { useListPets } from "@workspace/api-client-react";
import {
  Bell,
  Dog,
  Calendar,
  MessageSquare,
  RefreshCw,
  Sparkles,
  LogIn,
  LogOut,
  UtensilsCrossed,
  Pill,
  Footprints,
  Gamepad2,
  Camera,
  Video,
  FileText,
  Heart,
  AlertCircle,
} from "lucide-react";

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

  const [loadedMedia, setLoadedMedia] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
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

  const handleLoadMedia = useCallback(async () => {
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
  useEffect(() => {
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

export function TutorDashboard({ user }: { user: any }) {
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
