import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { FeedPost } from "../types/feed.types";
import { buildMediaSrc, getMediaToken } from "../utils/media.utils";

const EVENT_META: Record<string, { emoji: string; label: string }> = {
  photo:      { emoji: "📸", label: "Foto" },
  video:      { emoji: "🎥", label: "Vídeo" },
  note:       { emoji: "📝", label: "Nota" },
  play:       { emoji: "🎾", label: "Brincadeira" },
  walk:       { emoji: "🦮", label: "Passeio" },
  feeding:    { emoji: "🍽️", label: "Alimentação" },
  medication: { emoji: "💊", label: "Medicação" },
  health:     { emoji: "🏥", label: "Saúde" },
  check_in:   { emoji: "✅", label: "Check-in" },
  check_out:  { emoji: "🏠", label: "Check-out" },
};

interface FeedCardHeaderProps {
  post: FeedPost;
}

export function FeedCardHeader({ post }: FeedCardHeaderProps) {
  const meta = EVENT_META[post.type] ?? { emoji: "📌", label: post.type };
  const petNames = post.pets.map((p) => p.petName).join(", ");
  const relTime = formatDistanceToNow(new Date(post.createdAt), {
    addSuffix: true,
    locale: ptBR,
  });

  // Build avatar: prefer the first pet's photo; fall back to event-type emoji
  const firstPet = post.pets[0];
  const firstPhoto = firstPet?.petPhoto;
  const avatarSrc = firstPhoto
    ? (firstPhoto.startsWith("/objects/")
        ? buildMediaSrc(firstPhoto, getMediaToken())
        : firstPhoto)
    : null;

  return (
    <div className="p-4 flex items-center gap-3 border-b border-white/5">
      <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-xl overflow-hidden">
        {avatarSrc ? (
          <img
            src={avatarSrc}
            alt={firstPet?.petName ?? "pet"}
            className="h-full w-full object-cover rounded-full"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          meta.emoji
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-white truncate text-sm">
          {petNames || "Sem pet marcado"}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <span>{meta.label}</span>
          <span>·</span>
          <span>{relTime}</span>
        </div>
      </div>
    </div>
  );
}
