import React, { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListFeed, getListFeedQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { uploadFileDirect } from "@/lib/utils";
import { buildMediaSrc, getMediaToken } from "@/features/feed/utils/media.utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Camera, Sparkles, ImageIcon, X, Trash2, CheckCircle2, MoreHorizontal, Pencil, Video } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

// Assume we have pets from a query
import { useListPets } from "@workspace/api-client-react";

const EVENT_META: Record<string, { emoji: string; label: string; color: string }> = {
  photo:      { emoji: "📸", label: "Foto",         color: "bg-primary/10 text-primary border-primary/20" },
  video:      { emoji: "🎥", label: "Vídeo",        color: "bg-primary/10 text-primary border-primary/20" },
  note:       { emoji: "📝", label: "Nota",         color: "bg-secondary text-foreground border-border" },
  play:       { emoji: "🎾", label: "Brincadeira",  color: "bg-secondary text-foreground border-border" },
  walk:       { emoji: "🦮", label: "Passeio",      color: "bg-secondary text-foreground border-border" },
  feeding:    { emoji: "🍽️", label: "Alimentação", color: "bg-secondary text-foreground border-border" },
  medication: { emoji: "💊", label: "Medicação",    color: "bg-destructive/10 text-destructive border-destructive/20" },
  health:     { emoji: "🏥", label: "Saúde",        color: "bg-secondary text-foreground border-border" },
  check_in:   { emoji: "✅", label: "Check-in",     color: "bg-success/10 text-success border-success/20" },
  check_out:  { emoji: "🏠", label: "Check-out",    color: "bg-secondary text-foreground border-border" },
};

function getInitials(name: string) {
  return (name || "?").split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

function FeedCard({
  event,
  crecheId,
  user,
  onDeleted,
}: {
  event: any;
  crecheId: number;
  user: any;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  // V2 uses isLiked; V1 used isLikedByUser
  const [liked, setLiked] = useState<boolean>(event.isLiked ?? event.isLikedByUser ?? false);
  const [likeCount, setLikeCount] = useState<number>(event.likeCount ?? 0);
  // Lazy-load: for V1 posts (base64 mediaUrl), the full URL is fetched on demand.
  // For V2 posts (objectPath in mediaItems), we build the src directly.
  const [loadedMedia, setLoadedMedia] = useState<string | null>(null);
  const [loadedMediaType, setLoadedMediaType] = useState<"photo" | "video" | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(event.content || "");
  const [editSaving, setEditSaving] = useState(false);
  const queryClient = useQueryClient();

  // V2 format: mediaItems array with objectPaths served via /objects/
  // V1 format: event.mediaUrl (base64) and event.hasMedia flag
  const mediaFromItems: { objectPath: string; type: "photo" | "video" } | undefined =
    (event.mediaItems as any[])?.[0];

  // For V2 objectPaths: build an authenticated src URL immediately (no fetch needed)
  const mediaItemSrc = mediaFromItems
    ? buildMediaSrc(mediaFromItems.objectPath, getMediaToken())
    : null;

  // displayMedia: V2 inline → V1 lazy-loaded → V1 inline (legacy)
  const displayMedia = mediaItemSrc || event.mediaUrl || loadedMedia;

  // displayMediaType: prefer V2 mediaItems → V1 event.mediaType → lazy-loaded detail → event.type fallback
  const displayMediaType: "photo" | "video" | null =
    mediaFromItems?.type ??
    event.mediaType ??
    loadedMediaType ??
    (event.type === "video" ? "video" : event.type === "photo" ? "photo" : null);

  // hasMedia: true if there's a V2 mediaItem, a V1 hasMedia flag, a V1 mediaUrl, or
  // the type implies media (photo/video events always have media in this app)
  const hasMedia =
    !!mediaFromItems ||
    event.hasMedia === true ||
    !!event.mediaUrl ||
    event.type === "photo" ||
    event.type === "video";

  // Author name: V2 puts it in event.author.name; V1 put it in event.authorName directly
  const authorName = event.author?.name || event.authorName || "";

  const handleLoadMedia = React.useCallback(async () => {
    if (mediaLoading || loadedMedia) return;
    setMediaLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/feed/${event.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const url: string | undefined = data.mediaUrl;
      if (!url) return;

      // Save mediaType from the detail so we can render video vs photo correctly
      if (data.mediaType === "video" || data.mediaType === "photo") {
        setLoadedMediaType(data.mediaType);
      }

      // V2 objectPaths start with "/objects/" — convert to the authenticated
      // storage endpoint using the media token so <img>/<video> can load them.
      if (url.startsWith("/objects/")) {
        setLoadedMedia(buildMediaSrc(url, getMediaToken()));
      } else if (url.startsWith("/api/storage/")) {
        // Legacy: already a full API path — append media token
        const mt = encodeURIComponent(getMediaToken());
        setLoadedMedia(`${url}${url.includes("?") ? "&" : "?"}mt=${mt}`);
      } else {
        // base64 or blob URL — use directly
        setLoadedMedia(url);
      }
    } catch {
      // silent — media just won't show
    } finally {
      setMediaLoading(false);
    }
  }, [crecheId, event.id, loadedMedia, mediaLoading]);

  // Revoke blob URLs on unmount to avoid memory leaks
  React.useEffect(() => {
    return () => {
      if (loadedMedia && loadedMedia.startsWith("blob:")) {
        URL.revokeObjectURL(loadedMedia);
      }
    };
  }, [loadedMedia]);

  // Auto-load media as soon as the card mounts.
  // Only needed when there's no V2 mediaItem and no inline mediaUrl (i.e. old base64 posts).
  React.useEffect(() => {
    if (hasMedia && !mediaItemSrc && !event.mediaUrl && !loadedMedia) {
      handleLoadMedia();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = EVENT_META[event.type] || {
    emoji: "📌",
    label: event.type,
    color: "bg-secondary text-foreground border-border",
  };
  const date = new Date(event.createdAt);
  const relTime = formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
  const token = localStorage.getItem("auth_token");
  const canDelete = user?.role === "creche_admin" || user?.role === "staff";
  const canEdit = user?.role === "creche_admin" || user?.role === "staff";

  const handleLike = async () => {
    try {
      const res = await fetch(`/api/creches/${crecheId}/feed/${event.id}/like`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await res.json();
      setLiked(data.liked);
      setLikeCount(prev => data.liked ? prev + 1 : prev - 1);
    } catch (e) {
      console.error(e);
    }
  };

  const handleEditSave = async () => {
    setEditSaving(true);
    try {
      const res = await fetch(`/api/creches/${crecheId}/feed/${event.id}`, {
        method: "PATCH",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) {
        throw new Error("Falha ao salvar edição");
      }
      queryClient.invalidateQueries({ queryKey: getListFeedQueryKey(crecheId) });
      setEditing(false);
    } catch (e) {
      console.error(e);
      toast({
        title: "Erro ao editar publicação",
        description: "Não foi possível editar a publicação. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Tem certeza que deseja apagar?")) return;
    try {
      const res = await fetch(`/api/creches/${crecheId}/feed/${event.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error("Falha ao excluir publicação");
      }
      onDeleted();
    } catch (e) {
      console.error(e);
      toast({
        title: "Erro ao excluir publicação",
        description: "Não foi possível excluir a publicação. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 relative group">
      {canDelete && (
        <button
          onClick={handleDelete}
          className="absolute top-4 right-4 h-8 w-8 rounded-full bg-destructive/10 text-destructive opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-destructive/20"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      {/* Header */}
      <div className="p-4 flex items-center gap-3 border-b border-border">
        <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          <span className="text-xl">{meta.emoji}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate text-sm">
            {event.pets?.map((p: any) => p.petName).join(", ")}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span>{meta.label}</span>
            <span>•</span>
            <span>{relTime}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      {(event.content || hasMedia) && (
        <div className="p-4">
          {editing ? (
            <div className="mb-4 space-y-2">
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={3}
                className="w-full text-sm"
                autoFocus
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleEditSave} disabled={editSaving}>
                  {editSaving ? "Salvando..." : "Salvar"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditContent(event.content || ""); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : event.content && (
            <div className="relative group/caption mb-4">
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed pr-7">
                {event.content}
              </p>
              {canEdit && (
                <button
                  onClick={() => setEditing(true)}
                  className="absolute top-0 right-0 h-6 w-6 rounded-full bg-secondary hover:bg-secondary/80 flex items-center justify-center transition-colors"
                  title="Editar legenda"
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              )}
            </div>
          )}

          {/* Loading placeholder while media fetches automatically */}
          {hasMedia && !displayMedia && (
            <div className="w-full flex items-center justify-center gap-2 py-10 rounded-xl bg-secondary/40 border border-border text-sm text-muted-foreground animate-pulse">
              <Camera className="h-4 w-4" />
              Carregando foto...
            </div>
          )}

          {displayMedia && displayMediaType === "video" && (
            <div className="w-full rounded-xl overflow-hidden bg-muted">
              <video
                src={displayMedia}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-[480px] rounded-xl"
              />
            </div>
          )}

          {displayMedia && (displayMediaType === "photo" || !displayMediaType) && (
            <div
              className="relative w-full rounded-xl overflow-hidden cursor-zoom-in"
              style={{ maxHeight: expanded ? "none" : "300px" }}
              onClick={() => setExpanded(!expanded)}
            >
              <img
                src={displayMedia}
                alt="Foto"
                className="w-full object-cover transition-transform duration-300 hover:scale-105"
                style={{ height: expanded ? "auto" : "300px" }}
                loading="lazy"
              />
              {!expanded && (
                <div className="absolute bottom-3 right-3 bg-background/80 text-foreground border border-border backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1.5 shadow-lg">
                  <Sparkles className="h-3.5 w-3.5 text-primary" /> Ampliar
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 bg-secondary/20 border-t border-border flex items-center justify-between">
        <button
          onClick={handleLike}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-secondary/50 transition-colors text-sm font-medium"
        >
          <span className={`transition-transform duration-200 ${liked ? "scale-110" : ""}`}>
            {liked ? "❤️" : "🤍"}
          </span>
          <span className={liked ? "text-destructive" : "text-muted-foreground"}>
            {likeCount > 0 ? likeCount : "Curtir"}
          </span>
        </button>

        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <span>{authorName}</span>
        </div>
      </div>
    </div>
  );
}

export function FeedTab({ crecheId }: { crecheId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: feedData, isLoading, isError } = useListFeed(crecheId);
  
  // To allow tagging multiple pets in new post
  const { data: petsData } = useListPets(crecheId);
  const checkedInPets = ((petsData as any)?.items || []).filter((p: any) => p.isCheckedIn);

  const [content, setContent] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [selectedPets, setSelectedPets] = useState<number[]>([]);
  const [posting, setPosting] = useState(false);
  
  const [filterType, setFilterType] = useState("all");
  const [filterPet, setFilterPet] = useState("all");
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // API now returns { posts, nextCursor } (V2). Support both shapes for safety.
  const events = ((feedData as any)?.posts ?? (Array.isArray(feedData) ? feedData : [])).filter((evt: any) => {
    if (filterType !== "all" && evt.type !== filterType) return false;
    if (filterPet !== "all") {
      const hasPet = evt.pets?.some((p: any) => p.petId.toString() === filterPet);
      if (!hasPet) return false;
    }
    return true;
  });

  const handlePost = async () => {
    if (!content && !mediaFile) return;
    if (selectedPets.length === 0) {
      alert("Selecione pelo menos um pet");
      return;
    }
    setPosting(true);
    try {
      let mediaUrl: string | undefined = undefined;
      let mediaType: string | undefined = undefined;
      const token = localStorage.getItem("auth_token");

      if (mediaFile) {
        try {
          mediaUrl = await uploadFileDirect(mediaFile, token!);
        } catch {
          toast({
            title: "Upload indisponível",
            description: "Não foi possível enviar o arquivo no momento. Tente novamente.",
            variant: "destructive",
          });
          setPosting(false);
          return;
        }
        mediaType = mediaFile.type.startsWith("video/") ? "video" : "photo";
      }

      await fetch(`/api/creches/${crecheId}/feed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          type: mediaType === "video" ? "video" : mediaUrl ? "photo" : "note",
          content,
          mediaUrl,
          mediaType,
          petIds: selectedPets,
        })
      });

      setContent("");
      setMediaFile(null);
      setSelectedPets([]);
      queryClient.invalidateQueries({ queryKey: getListFeedQueryKey(crecheId) });
    } catch (e) {
      console.error(e);
    } finally {
      setPosting(false);
    }
  };

  const togglePet = (id: number) => {
    setSelectedPets(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const isStaff = user?.role === "staff" || user?.role === "creche_admin";

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      
      {/* Create Post Area (Staff only) */}
      {isStaff && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 shadow-xl">
          <div className="p-4 border-b border-border bg-card">
            <Textarea 
              placeholder="O que está acontecendo agora?"
              value={content}
              onChange={(e: any) => setContent(e.target.value)}
              className="bg-transparent border-none resize-none focus-visible:ring-0 px-0 min-h-[60px] text-base placeholder:text-muted-foreground/60"
            />
            
            {mediaFile && (
              <div className="relative mt-3 inline-block">
                {mediaFile.type.startsWith("video/") ? (
                  <video
                    src={URL.createObjectURL(mediaFile)}
                    className="h-32 rounded-lg border border-border bg-muted"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img src={URL.createObjectURL(mediaFile)} className="h-32 rounded-lg object-cover border border-border" />
                )}
                <button onClick={() => setMediaFile(null)} className="absolute -top-2 -right-2 h-6 w-6 bg-destructive rounded-full flex items-center justify-center text-destructive-foreground hover:bg-destructive/90 shadow-lg">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          
          <div className="p-4 bg-secondary/30">
            <div className="mb-3">
              <p className="text-xs font-medium text-muted-foreground mb-2">Marcar Pets (Presentes):</p>
              <div className="flex flex-wrap gap-2">
                {checkedInPets.map((pet: any) => (
                  <button 
                    key={pet.id} 
                    onClick={() => togglePet(pet.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      selectedPets.includes(pet.id) 
                        ? "bg-primary text-primary-foreground shadow-md shadow-primary/20 scale-105" 
                        : "bg-secondary text-muted-foreground hover:bg-secondary/80"
                    }`}
                  >
                    {selectedPets.includes(pet.id) && <CheckCircle2 className="h-3 w-3" />}
                    {pet.name}
                  </button>
                ))}
                {checkedInPets.length === 0 && (
                  <span className="text-xs text-muted-foreground italic">Nenhum pet presente no momento.</span>
                )}
              </div>
            </div>
            
            <div className="flex items-center justify-between mt-4">
              <input 
                type="file" 
                accept="image/*,video/*"
                className="hidden" 
                ref={fileInputRef} 
                onChange={e => e.target.files && setMediaFile(e.target.files[0])}
              />
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => fileInputRef.current?.click()}
                className="text-primary hover:text-primary hover:bg-primary/10 rounded-full"
              >
                {mediaFile?.type.startsWith("video/")
                  ? <Video className="h-4 w-4 mr-2" />
                  : <ImageIcon className="h-4 w-4 mr-2" />}
                Foto / Vídeo
              </Button>
              <Button 
                onClick={handlePost} 
                disabled={posting || (!content && !mediaFile) || selectedPets.length === 0}
                className="rounded-full px-6 shadow-lg shadow-primary/20"
              >
                {posting ? "Publicando..." : "Publicar"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Feed Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="flex-1 h-11 px-4 rounded-xl bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm hover:border-primary/40 transition-colors"
        >
          <option value="all">Todos os tipos de publicação</option>
          {Object.entries(EVENT_META).map(([key, meta]) => (
            <option key={key} value={key}>{meta.emoji} {meta.label}</option>
          ))}
        </select>
        <select
          value={filterPet}
          onChange={(e) => setFilterPet(e.target.value)}
          className="flex-1 h-11 px-4 rounded-xl bg-card border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary shadow-sm hover:border-primary/40 transition-colors"
        >
          <option value="all">Todos os pets</option>
          {((petsData as any)?.items || []).map((pet: any) => (
             <option key={pet.id} value={pet.id.toString()}>{pet.name} ({pet.breed || pet.species})</option>
          ))}
        </select>
      </div>

      {/* Feed List */}
      <div className="space-y-6">
        {isLoading && (
          <div className="flex flex-col gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-card border border-border rounded-2xl overflow-hidden animate-pulse">
                <div className="p-4 flex items-center gap-3 border-b border-border">
                  <div className="h-10 w-10 rounded-full bg-muted flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-1/3" />
                    <div className="h-3 bg-muted rounded w-1/4" />
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!isLoading && isError && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <X className="h-6 w-6 text-destructive" />
            </div>
            <p className="text-sm font-medium text-foreground">Não foi possível carregar o feed</p>
            <p className="text-xs text-muted-foreground">Verifique sua conexão e tente novamente.</p>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: getListFeedQueryKey(crecheId) })}
              className="text-xs text-primary hover:text-primary/80 transition-colors mt-1"
            >
              Tentar novamente
            </button>
          </div>
        )}
        {!isLoading && !isError && events.length === 0 && (
          <EmptyState 
            icon={Camera}
            title="Nenhuma novidade ainda"
            description="O feed da creche aparecerá aqui."
          />
        )}
        {!isLoading && !isError && events.map((evt: any) => (
          <FeedCard 
            key={evt.id} 
            event={evt} 
            crecheId={crecheId} 
            user={user as any} 
            onDeleted={() => queryClient.invalidateQueries({ queryKey: getListFeedQueryKey(crecheId) })}
          />
        ))}
      </div>
    </div>
  );
}
