import React, { useState, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListFeed, getListFeedQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { compressImage, uploadFileDirect } from "@/lib/utils";
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
  photo:      { emoji: "📸", label: "Foto",         color: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
  video:      { emoji: "🎥", label: "Vídeo",        color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
  note:       { emoji: "📝", label: "Nota",         color: "bg-white/10 text-white/70 border-white/10" },
  play:       { emoji: "🎾", label: "Brincadeira",  color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
  walk:       { emoji: "🦮", label: "Passeio",      color: "bg-green-500/20 text-green-300 border-green-500/30" },
  feeding:    { emoji: "🍽️", label: "Alimentação", color: "bg-orange-500/20 text-orange-300 border-orange-500/30" },
  medication: { emoji: "💊", label: "Medicação",    color: "bg-red-500/20 text-red-300 border-red-500/30" },
  health:     { emoji: "🏥", label: "Saúde",        color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
  check_in:   { emoji: "✅", label: "Check-in",     color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
  check_out:  { emoji: "🏠", label: "Check-out",    color: "bg-slate-500/20 text-slate-300 border-slate-500/30" },
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
  const [expanded, setExpanded] = useState(false);
  const [liked, setLiked] = useState<boolean>(event.isLikedByUser ?? false);
  const [likeCount, setLikeCount] = useState<number>(event.likeCount ?? 0);
  // Lazy-load: mediaUrl is stripped from the list payload to keep it small.
  // The full base64/URL is fetched on demand when the user taps "Ver foto".
  const [loadedMedia, setLoadedMedia] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(event.content || "");
  const [editSaving, setEditSaving] = useState(false);
  const queryClient = useQueryClient();

  const displayMedia = event.mediaUrl || loadedMedia;
  const hasMedia = event.hasMedia ?? !!event.mediaUrl;

  const handleLoadMedia = React.useCallback(async () => {
    if (mediaLoading || loadedMedia) return;
    setMediaLoading(true);
    try {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/feed/${event.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.mediaUrl) setLoadedMedia(data.mediaUrl);
      }
    } catch {
      // silent
    } finally {
      setMediaLoading(false);
    }
  }, [crecheId, event.id, loadedMedia, mediaLoading]);

  // Auto-load media as soon as the card mounts
  React.useEffect(() => {
    if (hasMedia && !event.mediaUrl && !loadedMedia) {
      handleLoadMedia();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meta = EVENT_META[event.type] || {
    emoji: "📌",
    label: event.type,
    color: "bg-white/10 text-white border-white/10",
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
      await fetch(`/api/creches/${crecheId}/feed/${event.id}`, {
        method: "PATCH",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      queryClient.invalidateQueries({ queryKey: getListFeedQueryKey(crecheId) });
      setEditing(false);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Tem certeza que deseja apagar?")) return;
    try {
      await fetch(`/api/creches/${crecheId}/feed/${event.id}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      onDeleted();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="bg-card border border-white/5 rounded-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 relative group">
      {canDelete && (
        <button
          onClick={handleDelete}
          className="absolute top-4 right-4 h-8 w-8 rounded-full bg-red-500/10 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-500/20"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      {/* Header */}
      <div className="p-4 flex items-center gap-3 border-b border-white/5">
        <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
          <span className="text-xl">{meta.emoji}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white truncate text-sm">
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
      {(event.content || event.mediaUrl) && (
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
              <p className="text-sm text-white/90 whitespace-pre-wrap leading-relaxed pr-7">
                {event.content}
              </p>
              {canEdit && (
                <button
                  onClick={() => setEditing(true)}
                  className="absolute top-0 right-0 opacity-0 group-hover/caption:opacity-100 transition-opacity h-6 w-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
                  title="Editar legenda"
                >
                  <Pencil className="h-3 w-3 text-white/60" />
                </button>
              )}
            </div>
          )}

          {/* Loading placeholder while media fetches automatically */}
          {hasMedia && !displayMedia && (
            <div className="w-full flex items-center justify-center gap-2 py-10 rounded-xl bg-white/5 border border-white/10 text-sm text-muted-foreground animate-pulse">
              <Camera className="h-4 w-4" />
              Carregando foto...
            </div>
          )}

          {displayMedia && event.mediaType === "video" && (
            <div className="w-full rounded-xl overflow-hidden bg-black">
              <video
                src={displayMedia}
                controls
                playsInline
                preload="metadata"
                className="w-full max-h-[480px] rounded-xl"
              />
            </div>
          )}

          {displayMedia && event.mediaType === "photo" && (
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
                <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-medium text-white flex items-center gap-1.5 shadow-lg">
                  <Sparkles className="h-3.5 w-3.5 text-yellow-400" /> Ampliar
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 bg-white/[0.02] border-t border-white/5 flex items-center justify-between">
        <button
          onClick={handleLike}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-white/5 transition-colors text-sm font-medium"
        >
          <span className={`transition-transform duration-200 ${liked ? "scale-110" : ""}`}>
            {liked ? "❤️" : "🤍"}
          </span>
          <span className={liked ? "text-rose-400" : "text-muted-foreground"}>
            {likeCount > 0 ? likeCount : "Curtir"}
          </span>
        </button>

        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <span>{event.authorName}</span>
        </div>
      </div>
    </div>
  );
}

export function FeedTab({ crecheId }: { crecheId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
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

  const events = (feedData || []).filter((evt: any) => {
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
        if (mediaFile.type.startsWith("video/")) {
          // Upload video direto via servidor (sem URL assinada — funciona em produção)
          mediaUrl = await uploadFileDirect(mediaFile, token!);
          mediaType = "video";
        } else {
          // Photo: compress to base64
          const compressedBase64 = await compressImage(mediaFile);
          mediaUrl = compressedBase64;
          mediaType = "photo";
        }
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
        <div className="bg-card rounded-2xl border border-white/10 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 shadow-xl">
          <div className="p-4 border-b border-white/5 bg-white/[0.02]">
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
                    className="h-32 rounded-lg border border-white/10 bg-black"
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  <img src={URL.createObjectURL(mediaFile)} className="h-32 rounded-lg object-cover border border-white/10" />
                )}
                <button onClick={() => setMediaFile(null)} className="absolute -top-2 -right-2 h-6 w-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 shadow-lg">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          
          <div className="p-4 bg-black/20">
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
                        : "bg-white/5 text-muted-foreground hover:bg-white/10"
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
          className="flex-1 h-11 px-4 rounded-xl bg-card border border-white/10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary shadow-sm hover:border-white/20 transition-colors"
        >
          <option value="all">Todos os tipos de publicação</option>
          {Object.entries(EVENT_META).map(([key, meta]) => (
            <option key={key} value={key}>{meta.emoji} {meta.label}</option>
          ))}
        </select>
        <select
          value={filterPet}
          onChange={(e) => setFilterPet(e.target.value)}
          className="flex-1 h-11 px-4 rounded-xl bg-card border border-white/10 text-sm text-white focus:outline-none focus:ring-1 focus:ring-primary shadow-sm hover:border-white/20 transition-colors"
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
              <div key={i} className="bg-card border border-white/5 rounded-2xl overflow-hidden animate-pulse">
                <div className="p-4 flex items-center gap-3 border-b border-white/5">
                  <div className="h-10 w-10 rounded-full bg-white/10 flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-white/10 rounded w-1/3" />
                    <div className="h-3 bg-white/10 rounded w-1/4" />
                  </div>
                </div>
                <div className="p-4 space-y-2">
                  <div className="h-3 bg-white/10 rounded w-full" />
                  <div className="h-3 bg-white/10 rounded w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!isLoading && isError && (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="h-12 w-12 rounded-full bg-red-500/10 flex items-center justify-center">
              <X className="h-6 w-6 text-red-400" />
            </div>
            <p className="text-sm font-medium text-white">Não foi possível carregar o feed</p>
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
