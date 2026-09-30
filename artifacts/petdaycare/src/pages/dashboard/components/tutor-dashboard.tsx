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
  ShoppingBag,
} from "lucide-react";

// ─── Notification Prompt Component ──────────────────────────────────────────
function NotificationPrompt() {
  const { isSupported, permission, isSubscribed, isLoading, subscribe } = usePush();
  const [dismissed, setDismissed] = useState(false);

  if (!isSupported || permission !== "default" || isSubscribed || dismissed) {
    return null;
  }

  return (
    <div className="mb-6 p-4 rounded-2xl bg-primary/10 border border-primary/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in">
      <div className="flex items-start sm:items-center gap-3.5">
        <div className="h-10 w-10 rounded-xl bg-primary/20 flex items-center justify-center shrink-0 mt-1 sm:mt-0">
          <Bell className="h-5 w-5 text-primary animate-pulse" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">Ative as Notificações</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            Receba alertas de reservas, check-in e mensagens em tempo real.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground">
          Agora não
        </Button>
        <Button size="sm" onClick={subscribe} isLoading={isLoading}>
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
      const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
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
  check_in:   { icon: <LogIn className="h-3.5 w-3.5" />,         label: "Check-in",    color: "text-success bg-success/15 border-success/30" },
  check_out:  { icon: <LogOut className="h-3.5 w-3.5" />,        label: "Check-out",   color: "text-warning bg-warning/15 border-warning/30" },
  feeding:    { icon: <UtensilsCrossed className="h-3.5 w-3.5" />, label: "Alimentação", color: "text-warning bg-warning/15 border-warning/30" },
  medication: { icon: <Pill className="h-3.5 w-3.5" />,          label: "Medicação",   color: "text-destructive bg-destructive/15 border-destructive/30" },
  walk:       { icon: <Footprints className="h-3.5 w-3.5" />,    label: "Passeio",     color: "text-primary bg-primary/15 border-primary/30" },
  play:       { icon: <Gamepad2 className="h-3.5 w-3.5" />,      label: "Brincadeira", color: "text-accent-foreground bg-accent border-border" },
  photo:      { icon: <Camera className="h-3.5 w-3.5" />,        label: "Foto",        color: "text-info bg-info/15 border-info/30" },
  video:      { icon: <Video className="h-3.5 w-3.5" />,         label: "Vídeo",       color: "text-info bg-info/15 border-info/30" },
  note:       { icon: <FileText className="h-3.5 w-3.5" />,      label: "Anotação",    color: "text-muted-foreground bg-secondary border-border" },
  health:     { icon: <Heart className="h-3.5 w-3.5" />,         label: "Saúde",       color: "text-destructive bg-destructive/15 border-destructive/30" },
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
  const displayMedia = (() => {
    if (!rawMedia) return null;
    if (rawMedia.startsWith("/objects/")) {
      return buildMediaSrc(rawMedia, getMediaToken());
    }
    const mt = typeof window !== "undefined" ? localStorage.getItem("media_token") || "" : "";
    if (rawMedia.startsWith("/api/storage") && mt) {
      return `${rawMedia}${rawMedia.includes("?") ? "&" : "?"}mt=${encodeURIComponent(mt)}`;
    }
    return rawMedia;
  })();
  const hasMedia = ev.hasMedia ?? !!ev.mediaUrl;

  const handleLoadMedia = useCallback(async () => {
    if (mediaLoading || loadedMedia) return;
    setMediaLoading(true);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
      const res = await fetch(`/api/creches/${crecheId}/feed/${ev.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const url: string | undefined = data.mediaUrl;
        if (!url) return;
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
    <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs">
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
          type="button"
          onClick={onLike}
          className={`flex items-center justify-center sm:justify-start gap-2 w-full sm:w-auto text-sm transition-colors py-2.5 px-3 min-h-[44px] rounded-lg hover:bg-secondary cursor-pointer ${
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
    const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
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

  const minDaysUntilDue = upcomingInvoices.reduce((min: number, inv: any) => {
    const diff = new Date(`${inv.dueDate}T00:00:00`).getTime() - new Date(`${todayBrazil()}T00:00:00`).getTime();
    const d = Math.round(diff / (1000 * 60 * 60 * 24));
    return d < min ? d : min;
  }, Infinity);
  const dueBadge = minDaysUntilDue === 0 ? "vence hoje" : minDaysUntilDue === 1 ? "vence em 1 dia" : `vence em ${minDaysUntilDue} dias`;

  return (
    <div className="space-y-6 animate-in fade-in duration-300 max-w-2xl mx-auto">
      <NotificationPrompt />

      {/* ── Avisos Financeiros (Faturas Atrasadas / Próximas) ── */}
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
              <p className="text-xs text-foreground mt-0.5 leading-relaxed">
                Você possui faturas em atraso. Regularize para continuar agendando.
              </p>
            </div>
          </div>
          <Link href="/tutor/financial" className="w-full sm:w-auto">
            <Button size="sm" variant="destructive" className="w-full sm:w-auto min-h-[44px]">
              Regularizar
            </Button>
          </Link>
        </div>
      )}
      {!invoicesLoading && overdueInvoices.length === 0 && upcomingInvoices.length > 0 && (
        <div className="mb-4 p-4 rounded-2xl bg-warning/10 border border-warning/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-warning/20 flex items-center justify-center shrink-0">
              <AlertCircle className="h-5 w-5 text-warning" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-warning">Fatura Próxima do Vencimento</h3>
              <p className="text-xs text-foreground mt-0.5 leading-relaxed">
                Você possui uma fatura que {dueBadge}.
              </p>
            </div>
          </div>
          <Link href="/tutor/financial" className="w-full sm:w-auto">
            <Button
              size="sm"
              variant="outline"
              className="w-full sm:w-auto border-warning/30 text-warning hover:bg-warning/10 min-h-[44px]"
            >
              Pagar agora
            </Button>
          </Link>
        </div>
      )}

      {/* ── Greeting & Pets Count ── */}
      <div className="flex items-start justify-between gap-4 pb-1 border-b border-border/40">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight text-foreground">
            {greeting}, {user.name.split(" ")[0]}!
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {myPets.length > 0
              ? `${myPets.length} pet${myPets.length !== 1 ? "s" : ""} cadastrado${myPets.length !== 1 ? "s" : ""}`
              : "Acompanhe seus pets em tempo real."}
          </p>
        </div>
        {checkedInPets.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/15 border border-success/30 flex-shrink-0 select-none">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
            <span className="text-xs text-success font-semibold tracking-tight">
              {checkedInPets.length} na creche
            </span>
          </div>
        )}
      </div>

      {/* ── Quick Actions Grid (Meus Pets, Reservas, Mensagens, Lojinha) ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4">
        <Link href="/pets" className="block">
          <div className="bg-card border border-border rounded-2xl px-3 sm:px-4 py-4 hover:bg-secondary/70 transition-all cursor-pointer flex flex-col items-center gap-2 text-center h-full shadow-xs group">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Dog className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                Meus Pets
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">
                {myPets.length} cadastrado{myPets.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </Link>
        <Link href="/bookings" className="block">
          <div className="bg-card border border-border rounded-2xl px-3 sm:px-4 py-4 hover:bg-secondary/70 transition-all cursor-pointer flex flex-col items-center gap-2 text-center h-full shadow-xs group">
            <div className="h-10 w-10 rounded-xl bg-info/15 border border-info/30 flex items-center justify-center group-hover:bg-info/25 transition-colors">
              <Calendar className="h-5 w-5 text-info" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                Reservas
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">Agendamentos</p>
            </div>
          </div>
        </Link>
        <Link href="/chat" className="block">
          <div className="bg-card border border-border rounded-2xl px-3 sm:px-4 py-4 hover:bg-secondary/70 transition-all cursor-pointer flex flex-col items-center gap-2 text-center h-full shadow-xs group">
            <div className="h-10 w-10 rounded-xl bg-success/15 border border-success/30 flex items-center justify-center group-hover:bg-success/25 transition-colors">
              <MessageSquare className="h-5 w-5 text-success" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                Mensagens
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">Fale com a creche</p>
            </div>
          </div>
        </Link>
        <Link href="/tutor/store" className="block">
          <div className="bg-card border border-border rounded-2xl px-3 sm:px-4 py-4 hover:bg-secondary/70 transition-all cursor-pointer flex flex-col items-center gap-2 text-center h-full shadow-xs group">
            <div className="h-10 w-10 rounded-xl bg-warning/15 border border-warning/30 flex items-center justify-center group-hover:bg-warning/25 transition-colors">
              <ShoppingBag className="h-5 w-5 text-warning" />
            </div>
            <div className="space-y-0.5">
              <p className="text-xs sm:text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                Lojinha
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">Produtos & snacks</p>
            </div>
          </div>
        </Link>
      </div>

      {/* ── Timeline Section ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg sm:text-xl font-display font-semibold text-foreground tracking-tight">
            Atividades dos seus pets
          </h2>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-sm font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5 min-h-[44px] px-2 cursor-pointer"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>

        {/* Loading skeleton */}
        {timelineLoading && (
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card border border-border rounded-2xl p-4 flex gap-3 animate-pulse shadow-xs">
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
          <div className="flex flex-col items-center gap-3 py-10 px-4 text-center bg-card border border-border rounded-2xl border-dashed">
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

        {/* Events list */}
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
