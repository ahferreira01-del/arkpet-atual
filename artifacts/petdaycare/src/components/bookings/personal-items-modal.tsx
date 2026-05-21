import { useState, useRef } from "react";
import { Camera, CheckCircle, Package, PackageX, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface PersonalItemsModalProps {
  booking: {
    id: number;
    petName?: string | null;
    crecheId: number;
  };
  open: boolean;
  onComplete: () => void;
}

type Step = "ask" | "camera" | "preview" | "uploading" | "saving" | "done";

async function requestUploadUrl(file: File, token: string): Promise<{ uploadURL: string; objectPath: string }> {
  const res = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type || "image/jpeg",
    }),
  });
  if (!res.ok) throw new Error("Erro ao obter URL de upload");
  return res.json();
}

async function uploadToStorage(file: File, uploadURL: string): Promise<void> {
  const res = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "image/jpeg" },
  });
  if (!res.ok) throw new Error("Erro ao enviar foto");
}

async function savePersonalItems(
  crecheId: number,
  bookingId: number,
  hasItems: boolean,
  photoUrl: string | null,
  token: string,
): Promise<void> {
  const res = await fetch(`/api/creches/${crecheId}/bookings/${bookingId}/personal-items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ hasItems, photoUrl }),
  });
  if (!res.ok) throw new Error("Erro ao salvar itens pessoais");
}

export function PersonalItemsModal({ booking, open, onComplete }: PersonalItemsModalProps) {
  const [step, setStep] = useState<Step>("ask");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const petName = booking.petName ?? "o pet";

  const reset = () => {
    setStep("ask");
    setPhotoFile(null);
    setPreviewUrl(null);
  };

  const handleNoItems = async () => {
    setStep("saving");
    try {
      const token = localStorage.getItem("auth_token") ?? "";
      await savePersonalItems(booking.crecheId, booking.id, false, null, token);
      setStep("done");
      setTimeout(() => { reset(); onComplete(); }, 1200);
    } catch {
      toast({ title: "Erro ao registrar", description: "Tente novamente.", variant: "destructive" });
      setStep("ask");
    }
  };

  const handleHasItems = () => {
    setStep("camera");
    setTimeout(() => fileInputRef.current?.click(), 100);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) { setStep("ask"); return; }
    setPhotoFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setStep("preview");
  };

  const handleRetake = () => {
    setPhotoFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setStep("camera");
    setTimeout(() => fileInputRef.current?.click(), 100);
  };

  const handleConfirmPhoto = async () => {
    if (!photoFile) return;
    setStep("uploading");
    try {
      const token = localStorage.getItem("auth_token") ?? "";
      const { uploadURL, objectPath } = await requestUploadUrl(photoFile, token);
      setStep("uploading");
      await uploadToStorage(photoFile, uploadURL);
      setStep("saving");
      await savePersonalItems(booking.crecheId, booking.id, true, objectPath, token);
      setStep("done");
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setTimeout(() => { reset(); onComplete(); }, 1200);
    } catch (err: any) {
      toast({
        title: "Erro ao salvar foto",
        description: err?.message ?? "Tente novamente.",
        variant: "destructive",
      });
      setStep("preview");
    }
  };

  return (
    <Modal isOpen={open} onClose={() => {}} title="">
      {/* Hidden file input — camera only on mobile */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {step === "ask" && (
        <div className="flex flex-col items-center gap-6 py-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/15 flex items-center justify-center">
            <Package className="h-8 w-8 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">Itens pessoais</h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-white">{petName}</span> trouxe itens pessoais?<br />
              <span className="text-xs">(coleira, ração, pote, etc.)</span>
            </p>
          </div>
          <div className="flex gap-3 w-full">
            <Button
              variant="outline"
              className="flex-1 border-white/15 text-muted-foreground hover:text-white"
              onClick={handleNoItems}
            >
              <PackageX className="mr-2 h-4 w-4" />
              Não trouxe
            </Button>
            <Button
              className="flex-1 bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
              onClick={handleHasItems}
            >
              <Camera className="mr-2 h-4 w-4" />
              Sim, tirar foto
            </Button>
          </div>
        </div>
      )}

      {step === "camera" && (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Abrindo câmera...</p>
        </div>
      )}

      {step === "preview" && previewUrl && (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold text-white mb-0.5">Confirmar foto</h2>
            <p className="text-xs text-muted-foreground">Verifique se todos os itens estão visíveis na foto.</p>
          </div>
          <div className="relative rounded-xl overflow-hidden bg-white/5 aspect-[4/3]">
            <img
              src={previewUrl}
              alt="Itens pessoais"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 border-white/15" onClick={handleRetake}>
              <Camera className="mr-2 h-4 w-4" /> Repetir
            </Button>
            <Button className="flex-1" onClick={handleConfirmPhoto}>
              Confirmar foto
            </Button>
          </div>
        </div>
      )}

      {(step === "uploading" || step === "saving") && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium text-white">
              {step === "uploading" ? "Enviando foto..." : "Salvando registro..."}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Aguarde um momento</p>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-emerald-400" />
          </div>
          <p className="text-sm font-medium text-white">Itens registrados com sucesso!</p>
        </div>
      )}
    </Modal>
  );
}
