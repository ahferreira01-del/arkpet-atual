import React, { useRef, useEffect, useState, useCallback } from "react";
import { resolvePhotoUrl } from "@/lib/utils";
import { PetAvatar } from "@/components/pet-avatar";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QrCode, Camera, Dog, AlertTriangle, CheckCircle2, XCircle, RefreshCw, LogIn } from "lucide-react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import jsQR from "jsqr";

type ScanState = "idle" | "scanning" | "found" | "checking_in" | "checked_in" | "error";

function useQrCheckIn(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: number) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/creches/${crecheId}/bookings/${bookingId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error("Erro ao realizar check-in");
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export default function QrScanner() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number>(0);

  const [scanState, setScanState] = useState<ScanState>("idle");
  const [petInfo, setPetInfo] = useState<any | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [cameraError, setCameraError] = useState<string>("");

  const checkInMutation = useQrCheckIn(crecheId);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError("");
    setScanState("scanning");
    setPetInfo(null);
    setErrorMsg("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      scanLoop();
    } catch {
      setCameraError("Não foi possível acessar a câmera. Verifique as permissões.");
      setScanState("idle");
    }
  }, []);

  const scanLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      animRef.current = requestAnimationFrame(scanLoop);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) { animRef.current = requestAnimationFrame(scanLoop); return; }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });

    if (code?.data) {
      stopCamera();
      setScanState("found");
      lookupQrToken(code.data);
    } else {
      animRef.current = requestAnimationFrame(scanLoop);
    }
  }, [stopCamera]);

  const lookupQrToken = async (token: string) => {
    const authToken = localStorage.getItem("auth_token");
    try {
      const r = await fetch(`/api/creches/${crecheId}/pets/by-qr/${encodeURIComponent(token)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setErrorMsg(data.error || "Pet não encontrado para este QR Code.");
        setScanState("error");
        return;
      }
      const data = await r.json();
      setPetInfo(data);
      setScanState("found");
    } catch {
      setErrorMsg("Erro ao conectar com o servidor.");
      setScanState("error");
    }
  };

  const handleCheckIn = async () => {
    if (!petInfo?.bookingId) return;
    setScanState("checking_in");
    checkInMutation.mutate(petInfo.bookingId, {
      onSuccess: (updatedPet) => {
        setPetInfo((prev: any) => ({ ...prev, isCheckedIn: true }));
        setScanState("checked_in");
      },
      onError: () => {
        setErrorMsg("Erro ao realizar check-in. Tente novamente.");
        setScanState("error");
      },
    });
  };

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const reset = () => {
    stopCamera();
    setScanState("idle");
    setPetInfo(null);
    setErrorMsg("");
  };

  const canCheckIn = petInfo && petInfo.bookingId && !petInfo.isCheckedIn;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-lg mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={() => window.history.back()} className="h-10 w-10 rounded-full border border-white/5 bg-[#16171a] flex items-center justify-center text-gray-400 hover:text-white transition-colors">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div>
          <h1 className="text-[28px] leading-tight font-display font-bold text-white flex items-center gap-2">
            Leitor QR Code <span className="text-[#84a93a]">QR</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1">Escaneie o QR Code da coleira do pet para check-in rápido e seguro.</p>
        </div>
      </div>

      <Card className="bg-[#16171a] border-0 rounded-[24px]">
        <CardContent className="p-6 space-y-5">
          {/* Camera / Result area */}
          <div className="relative aspect-square rounded-2xl overflow-hidden bg-black/60 flex items-center justify-center border border-white/10">
            <video
              ref={videoRef}
              className={`w-full h-full object-cover ${scanState === "scanning" ? "block" : "hidden"}`}
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />

            {scanState === "idle" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
                {/* Custom four corners */}
                <div className="absolute top-6 left-6 w-8 h-8 border-t-2 border-l-2 border-[#84a93a] rounded-tl-xl" />
                <div className="absolute top-6 right-6 w-8 h-8 border-t-2 border-r-2 border-[#84a93a] rounded-tr-xl" />
                <div className="absolute bottom-6 left-6 w-8 h-8 border-b-2 border-l-2 border-[#84a93a] rounded-bl-xl" />
                <div className="absolute bottom-6 right-6 w-8 h-8 border-b-2 border-r-2 border-[#84a93a] rounded-br-xl" />
                
                <div className="flex flex-col items-center justify-center space-y-4 text-center mt-4">
                  <div className="h-24 w-24 border-[3px] border-dashed border-gray-600 rounded-3xl flex items-center justify-center opacity-40">
                     <QrCode className="h-10 w-10 text-gray-400" />
                  </div>
                  <p className="text-[15px] font-medium text-gray-400 max-w-[220px] mx-auto mt-6">
                    Centralize o QR Code da coleira do pet dentro do quadro para escanear.
                  </p>
                </div>
              </div>
            )}

            {scanState === "scanning" && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-56 h-56 border-2 border-primary rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-xl" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-xl" />
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-xl" />
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-xl" />
                    <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-primary/70 animate-pulse -translate-y-1/2" />
                  </div>
                </div>
                <p className="absolute bottom-4 left-0 right-0 text-center text-xs text-white/60">
                  Aponte para o QR Code...
                </p>
              </div>
            )}

            {(scanState === "found" || scanState === "checking_in") && petInfo && (
              <div className="text-center p-6 space-y-3 w-full">
                {scanState === "checking_in" ? (
                  <div className="h-14 w-14 rounded-full bg-primary/20 border-2 border-primary animate-pulse mx-auto flex items-center justify-center">
                    <LogIn className="h-7 w-7 text-primary" />
                  </div>
                ) : (
                  <CheckCircle2 className="h-14 w-14 text-emerald-400 mx-auto" />
                )}
                <div className="h-20 w-20 rounded-full bg-white/10 border-4 border-emerald-400/30 overflow-hidden flex items-center justify-center mx-auto">
                  <PetAvatar
                    photoUrl={petInfo.photoUrl}
                    name={petInfo.name}
                    className="h-full w-full object-cover"
                    iconClassName="h-10 w-10 text-white/30"
                  />
                </div>
                <div>
                  <h2 className="text-xl font-display font-bold text-white">{petInfo.name}</h2>
                  <p className="text-muted-foreground text-sm capitalize">{petInfo.breed || petInfo.species}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Tutor: {petInfo.tutorName || "—"}</p>
                </div>
                <div className="flex gap-2 justify-center flex-wrap">
                  <Badge variant={petInfo.isCheckedIn ? "success" : "secondary"}>
                    {petInfo.isCheckedIn ? "Presente na creche" : "Em casa"}
                  </Badge>
                  {petInfo.hasActiveBooking ? (
                    <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30">Reserva confirmada</Badge>
                  ) : (
                    <Badge variant="warning">Sem reserva ativa</Badge>
                  )}
                </div>
              </div>
            )}

            {scanState === "checked_in" && petInfo && (
              <div className="text-center p-6 space-y-3 w-full">
                <div className="h-14 w-14 rounded-full bg-emerald-500/20 border-2 border-emerald-400 mx-auto flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                </div>
                <div className="h-20 w-20 rounded-full bg-white/10 border-4 border-emerald-400/40 overflow-hidden flex items-center justify-center mx-auto">
                  <PetAvatar
                    photoUrl={petInfo.photoUrl}
                    name={petInfo.name}
                    className="h-full w-full object-cover"
                    iconClassName="h-10 w-10 text-white/30"
                  />
                </div>
                <div>
                  <h2 className="text-xl font-display font-bold text-white">{petInfo.name}</h2>
                  <p className="text-xs font-semibold text-emerald-400 mt-1">✓ Check-in realizado com sucesso!</p>
                </div>
                <Badge variant="success" className="text-sm px-4 py-1">Presente na creche</Badge>
              </div>
            )}

            {scanState === "error" && (
              <div className="text-center p-8 space-y-4">
                <XCircle className="h-14 w-14 text-destructive mx-auto" />
                <p className="text-destructive text-sm">{errorMsg}</p>
              </div>
            )}
          </div>

          {cameraError && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              {cameraError}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2">
            {(scanState === "idle" || scanState === "error") && (
              <Button className="w-full" onClick={startCamera}>
                <Camera className="mr-2 h-4 w-4" /> Escanear QR Code
              </Button>
            )}
            {scanState === "scanning" && (
              <Button variant="outline" className="w-full" onClick={reset}>
                Cancelar
              </Button>
            )}
            {scanState === "found" && (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={reset}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Outro
                </Button>
                {canCheckIn && (
                  <Button
                    className="flex-1 shadow-[0_0_20px_rgba(139,92,246,0.4)]"
                    onClick={handleCheckIn}
                    isLoading={checkInMutation.isPending}
                  >
                    <LogIn className="mr-2 h-4 w-4" /> Fazer Check-in
                  </Button>
                )}
                {!canCheckIn && petInfo && (
                  <Button className="flex-1" onClick={() => navigate(`/pets/${petInfo.id}`)}>
                    <Dog className="mr-2 h-4 w-4" /> Ver Perfil
                  </Button>
                )}
              </div>
            )}
            {scanState === "checking_in" && (
              <Button disabled className="w-full" isLoading>
                Realizando check-in...
              </Button>
            )}
            {scanState === "checked_in" && (
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={reset}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Escanear Outro
                </Button>
                {petInfo && (
                  <Button className="flex-1" onClick={() => navigate(`/pets/${petInfo.id}`)}>
                    <Dog className="mr-2 h-4 w-4" /> Ver Perfil
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-white/3">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1.5">
          <p className="font-medium text-white/60">Como usar:</p>
          <p>• Clique em "Escanear QR Code" para ativar a câmera traseira.</p>
          <p>• Posicione o QR Code da coleira do pet dentro do quadro.</p>
          <p>• O sistema identifica o pet e exibe o botão de check-in automaticamente.</p>
          <p>• Pets sem reserva confirmada não podem fazer check-in.</p>
        </CardContent>
      </Card>
    </div>
  );
}
