import { useRef } from "react";
import { ImageIcon, Video, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface MediaPickerProps {
  file: File | null;
  error: string | null;
  onSelect: (file: File) => void;
  onRemove: () => void;
}

export function MediaPicker({ file, error, onSelect, onRemove }: MediaPickerProps) {
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) onSelect(selected);
    // Reset input so the same file can be re-selected after removal
    e.target.value = "";
  };

  return (
    <div className="space-y-3">
      {/* Preview */}
      {file && (
        <div className="relative inline-block">
          {file.type.startsWith("video/") ? (
            <video
              src={URL.createObjectURL(file)}
              className="h-36 rounded-xl border border-white/10 bg-black"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={URL.createObjectURL(file)}
              alt="Preview"
              className="h-36 rounded-xl object-cover border border-white/10"
            />
          )}
          <button
            type="button"
            onClick={onRemove}
            className="absolute -top-2 -right-2 h-6 w-6 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white shadow-lg transition-colors"
            title="Remover mídia"
          >
            <X className="h-3 w-3" />
          </button>
          <div className="mt-1 text-xs text-muted-foreground truncate max-w-[14rem]">
            {file.name}
          </div>
        </div>
      )}

      {/* Validation error */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Buttons (hidden when file selected) */}
      {!file && (
        <div className="flex gap-2">
          <input
            ref={photoRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleChange}
          />
          <input
            ref={videoRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={handleChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => photoRef.current?.click()}
            className="gap-1.5 rounded-full border-white/10 hover:bg-white/5"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Foto
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => videoRef.current?.click()}
            className="gap-1.5 rounded-full border-white/10 hover:bg-white/5"
          >
            <Video className="h-3.5 w-3.5" />
            Vídeo
          </Button>
        </div>
      )}
    </div>
  );
}
