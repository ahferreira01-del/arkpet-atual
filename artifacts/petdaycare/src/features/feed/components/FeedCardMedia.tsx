import { useEffect, useRef, useState } from "react";
import { Expand } from "lucide-react";
import type { MediaItem } from "../types/feed.types";
import { buildMediaSrc, getMediaToken } from "../utils/media.utils";
import { recordView } from "../api/feed.api";

interface FeedCardMediaProps {
  postId: number;
  crecheId: number;
  mediaItems: MediaItem[];
}

/**
 * Renders the first media item in a post.
 * - Photos: <img loading="lazy"> — native lazy loading, zero JS overhead.
 * - Videos: IntersectionObserver defers the preload until the card enters the
 *   viewport, preventing simultaneous metadata loads on mobile.
 * - View tracking: fires once via IntersectionObserver (threshold 0.5, 1s delay).
 */
export function FeedCardMedia({ postId, crecheId, mediaItems }: FeedCardMediaProps) {
  const item = mediaItems[0];
  if (!item) return null;

  const mediaToken = getMediaToken();
  const src = buildMediaSrc(item.objectPath, mediaToken);

  if (item.type === "photo") {
    return (
      <PhotoMedia postId={postId} crecheId={crecheId} src={src} />
    );
  }

  return (
    <VideoMedia postId={postId} crecheId={crecheId} src={src} />
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function PhotoMedia({
  postId,
  crecheId,
  src,
}: {
  postId: number;
  crecheId: number;
  src: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);

  // View tracking
  useViewTracking(ref, postId, crecheId);

  return (
    <div
      ref={ref}
      className="relative w-full overflow-hidden rounded-xl cursor-zoom-in bg-white/5"
      onClick={() => setExpanded((v) => !v)}
    >
      <img
        src={src}
        alt="Foto do pet"
        loading="lazy"
        className="w-full object-cover transition-transform duration-300 hover:scale-[1.01]"
        style={{ maxHeight: expanded ? "none" : "320px" }}
      />
      {!expanded && (
        <div className="absolute bottom-3 right-3 bg-secondary/90 px-3 py-1.5 rounded-full text-xs font-semibold text-secondary-foreground flex items-center gap-1.5 shadow-sm pointer-events-none">
          <Expand className="h-3.5 w-3.5" />
          Ampliar
        </div>
      )}
    </div>
  );
}

function VideoMedia({
  postId,
  crecheId,
  src,
}: {
  postId: number;
  crecheId: number;
  src: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef     = useRef<HTMLVideoElement>(null);
  const [inView, setInView] = useState(false);

  // Defer video preload until in viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setInView(true); },
      { threshold: 0.25 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // View tracking
  useViewTracking(containerRef, postId, crecheId);

  return (
    <div ref={containerRef} className="w-full rounded-xl overflow-hidden bg-black">
      <video
        ref={videoRef}
        src={inView ? src : undefined}
        controls
        playsInline
        preload={inView ? "metadata" : "none"}
        className="w-full max-h-[480px] rounded-xl"
        poster={inView ? undefined : ""}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: view tracking hook
// ─────────────────────────────────────────────────────────────────────────────

function useViewTracking(
  ref: React.RefObject<Element | null>,
  postId: number,
  crecheId: number,
) {
  const tracked = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || tracked.current) return;

    let timer: ReturnType<typeof setTimeout>;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !tracked.current) {
          timer = setTimeout(() => {
            if (!tracked.current) {
              tracked.current = true;
              const token = localStorage.getItem("auth_token") ?? "";
              recordView(crecheId, postId, token);
            }
          }, 1000);
        } else {
          clearTimeout(timer);
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [postId, crecheId, ref]);
}
