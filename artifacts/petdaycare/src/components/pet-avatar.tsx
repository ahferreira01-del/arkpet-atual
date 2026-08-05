import { useEffect, useState } from "react";
import { resolvePhotoUrl } from "@/lib/utils";
import { Dog, Cat } from "lucide-react";

interface PetAvatarProps {
  photoUrl: string | null | undefined;
  name: string;
  species?: string | null;
  className?: string;
  iconClassName?: string;
}

/**
 * Renders a pet's profile photo with automatic media-token refresh.
 *
 * resolvePhotoUrl() reads the media token from localStorage at render time.
 * If the token was expired when the component first mounted, the image would
 * show as broken even after use-auth.tsx refreshed the token — because
 * localStorage changes don't trigger React re-renders.
 *
 * This component subscribes to the "media_token_refresh" custom event
 * (emitted by use-auth.tsx after every token save) and re-resolves the URL,
 * so the image loads correctly even when the token is refreshed mid-session.
 */
export function PetAvatar({ photoUrl, name, species, className = "h-full w-full object-cover", iconClassName = "h-8 w-8 text-white/30" }: PetAvatarProps) {
  const [src, setSrc] = useState<string | null>(() => resolvePhotoUrl(photoUrl));

  useEffect(() => {
    // Re-resolve when the URL prop changes
    setSrc(resolvePhotoUrl(photoUrl));
  }, [photoUrl]);

  useEffect(() => {
    const handleRefresh = () => {
      setSrc(resolvePhotoUrl(photoUrl));
    };
    window.addEventListener("media_token_refresh", handleRefresh);
    return () => window.removeEventListener("media_token_refresh", handleRefresh);
  }, [photoUrl]);

  if (!src) {
    const Icon = species === "cat" ? Cat : Dog;
    return <Icon className={iconClassName} />;
  }

  return (
    <img
      src={src}
      alt={name}
      className={className}
      onError={() => {
        // If the image fails (e.g. 401 with a still-expired token), wait for
        // the next media_token_refresh event — which will fire when the auth
        // hook finishes the refresh — and then re-render.
        setSrc(null);
      }}
    />
  );
}
