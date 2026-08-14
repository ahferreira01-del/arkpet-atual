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
    <div className="space-y-4">
      {/* Preview */}
      {file && (
        <div className="relative inline-block w-full sm:w-auto">
          {file.type.startsWith("video/") ? (
            <video
              src={URL.createObjectURL(file)}
              className="h-48 sm:h-36 w-full sm:w-auto rounded-2xl border border-border bg-black object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={URL.createObjectURL(file)}
              alt="Preview"
              className="h-48 sm:h-36 w-full sm:w-auto rounded-2xl object-cover border border-border"
            />
          )}
          <button
            type="button"
            onClick={onRemove}
            className="absolute -top-3 -right-3 h-11 w-11 bg-destructive hover:bg-destructive/90 rounded-full flex items-center justify-center text-destructive-foreground shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
            title="Remover mídia"
            aria-label="Remover mídia selecionada"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="mt-2 text-sm font-medium text-muted-foreground truncate w-full sm:max-w-[14rem] text-center sm:text-left px-2 sm:px-0">
            {file.name}
          </div>
        </div>
      )}

      {/* Validation error */}
      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-3">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <p className="font-medium">{error}</p>
        </div>
      )}

      {/* Buttons (hidden when file selected) */}
      {!file && (
        <div className="flex gap-3">
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
            onClick={() => photoRef.current?.click()}
            className="h-11 px-6 rounded-full font-medium bg-secondary hover:bg-secondary/80 border-transparent text-foreground shadow-sm flex-1 sm:flex-none"
          >
            <ImageIcon className="h-4 w-4 mr-2" />
            Foto
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => videoRef.current?.click()}
            className="h-11 px-6 rounded-full font-medium bg-secondary hover:bg-secondary/80 border-transparent text-foreground shadow-sm flex-1 sm:flex-none"
          >
            <Video className="h-4 w-4 mr-2" />
            Vídeo
          </Button>
        </div>
      )}
    </div>
  );
}
