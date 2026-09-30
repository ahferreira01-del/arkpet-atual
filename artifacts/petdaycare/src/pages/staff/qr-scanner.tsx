import React, { useRef, useEffect, useState, useCallback } from "react";
import { resolvePhotoUrl } from "@/lib/utils";
import { PetAvatar } from "@/components/pet-avatar";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { QrCode, Camera, Dog, AlertTriangle, CheckCircle2, XCircle, RefreshCw, LogIn } from "lucide-react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useCheckIn,
  useListTasks,
  getListBookingsQueryKey,
  getListPetsQueryKey,
  getGetCrecheStatsQueryKey,
  getListTasksQueryKey,
} from "@workspace/api-client-react";
import { todayBrazil } from "@/lib/date-utils";
import jsQR from "jsqr";

const TASK_TYPE_LABELS: Record<string, string> = {
  feeding: "Alimentação",
  medication: "Medicação",
  grooming: "Banho/Tosa",
  walk: "Passeio",
  play: "Brincadeira",
  health_check: "Checagem de saúde",
  other: "Outro",
};

const TASK_TYPE_ORDER = [
  "feeding",
  "medication",
  "walk",
  "grooming",
  "play",
  "health_check",
  "other",
];

type ScanState = "idle" | "scanning" | "found" | "checking_in" | "checked_in" | "error";

export default function QrScanner() {
  const { user } = useAuth();
  const crecheId = user?.crecheId as number;
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

  const checkInMutation = useCheckIn();

  const today = todayBrazil();
  const { data: tasks, isLoading: tasksLoading, isError: tasksError } = useListTasks(
    crecheId,
    { status: "pending", date: today }
  );

  const petTasks = petInfo && tasks && !tasksLoading && !tasksError
    ? tasks.filter((t: any) => t.petId === petInfo.id)
    : null;

  const groupedPetTasks = petTasks && petTasks.length > 0
    ? TASK_TYPE_ORDER
        .map((type) => {
          const count = petTasks.filter((t: any) => t.type === type).length;
          return count > 0 ? { type, label: TASK_TYPE_LABELS[type] || type, count } : null;
        })
        .filter(Boolean) as { type: string; label: string; count: number }[]
    : [];

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
    checkInMutation.mutate({ crecheId, bookingId: petInfo.bookingId }, {
      onSuccess: (updatedPet) => {
        if (crecheId) {
          queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey(crecheId) });
          queryClient.invalidateQueries({ queryKey: getListPetsQueryKey(crecheId) });
          queryClient.invalidateQueries({ queryKey: getGetCrecheStatsQueryKey(crecheId) });
          queryClient.invalidateQueries({ queryKey: getListTasksQueryKey(crecheId) });
        }
        setPetInfo((prev: any) => ({ ...prev, isCheckedIn: true }));
        setScanState("checked_in");
      },
      onError: () => {
        setErrorMsg("Erro ao realizar check-in. Tente novamente.");
        setScanState("error");
      },
    });
  };

  const reset = useCallback(() => {
    stopCamera();
    setScanState("idle");
    setPetInfo(null);
    setErrorMsg("");
  }, [stopCamera]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.hidden && streamRef.current) {
        reset();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stopCamera();
    };
  }, [stopCamera, reset]);

  const canCheckIn = petInfo && petInfo.bookingId && !petInfo.isCheckedIn;

  return (
    <div className="pb-nav-safe space-y-6 animate-in fade-in duration-300 max-w-lg mx-auto">
      <PageHeader
        title="QR Scanner"
        description="Check-in operacional rápido."
        icon={QrCode}
        className="px-1"
      />

      <Card className="bg-card border-border overflow-hidden shadow-sm">
        <CardContent className="p-4 sm:p-6 space-y-6">
          
          {/* Camera / Result area */}
          <div className="relative aspect-square sm:aspect-[4/5] rounded-xl overflow-hidden bg-muted/60 flex items-center justify-center border border-border">
            <video
              ref={videoRef}
              className={`w-full h-full object-cover ${scanState === "scanning" ? "block" : "hidden"}`}
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />

            {scanState === "idle" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center">
                <div className="h-20 w-20 border-2 border-dashed border-border rounded-2xl flex items-center justify-center mb-6">
                  <QrCode className="h-8 w-8 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-muted-foreground max-w-[220px] mx-auto">
                  Toque no botão abaixo para ativar a câmera e iniciar a leitura.
                </p>
              </div>
            )}

            {scanState === "scanning" && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-56 h-56 border border-primary/40 rounded-xl shadow-[0_0_0_9999px_rgba(0,0,0,0.65)] relative">
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary rounded-tl-xl" />
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary rounded-tr-xl" />
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary rounded-bl-xl" />
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary rounded-br-xl" />
                  </div>
                </div>
                <div className="absolute bottom-6 left-0 right-0 flex justify-center">
                  <Badge variant="secondary" className="bg-background/80 text-foreground border-border backdrop-blur-md font-medium">
                    Enquadre o QR Code
                  </Badge>
                </div>
              </div>
            )}

            {(scanState === "found" || scanState === "checking_in") && petInfo && (
              <div className="text-center p-6 space-y-4 w-full">
                {scanState === "checking_in" ? (
                  <div className="h-16 w-16 rounded-full bg-primary/20 border border-primary/50 animate-pulse mx-auto flex items-center justify-center">
                    <LogIn className="h-7 w-7 text-primary" />
                  </div>
                ) : (
                  <div className="h-16 w-16 rounded-full bg-secondary border border-border overflow-hidden mx-auto flex items-center justify-center">
                    <PetAvatar
                      photoUrl={petInfo.photoUrl}
                      name={petInfo.name}
                      className="h-full w-full object-cover"
                      iconClassName="h-8 w-8 text-muted-foreground"
                    />
                  </div>
                )}
                
                <div>
                  <h2 className="text-2xl font-display font-bold text-foreground">{petInfo.name}</h2>
                  <p className="text-muted-foreground text-sm mt-0.5">{petInfo.tutorName || "Tutor não registrado"}</p>
                </div>

                <div className="flex gap-2 justify-center flex-wrap pt-2">
                  <Badge variant={petInfo.isCheckedIn ? "success" : "secondary"}>
                    {petInfo.isCheckedIn ? "Presente" : "Em casa"}
                  </Badge>
                  {petInfo.hasActiveBooking ? (
                    <Badge variant="default">
                      Reserva Ativa
                    </Badge>
                  ) : (
                    <Badge variant="destructive">Sem Reserva</Badge>
                  )}
                </div>

                {petTasks !== null && (
                  <div className="pt-2 border-t border-border mt-2 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Tarefas pendentes hoje</p>
                    {petTasks.length > 0 ? (
                      <div className="flex gap-1.5 justify-center flex-wrap">
                        {groupedPetTasks.map((item) => (
                          <Badge
                            key={item.type}
                            variant="secondary"
                            className="text-xs px-2 py-0.5"
                          >
                            {item.count}x {item.label}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Nenhuma tarefa pendente para hoje</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {scanState === "checked_in" && petInfo && (
              <div className="text-center p-6 space-y-4 w-full">
                <div className="h-16 w-16 rounded-full bg-success/20 border border-success/50 mx-auto flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-success" />
                </div>
                
                <div className="h-16 w-16 rounded-full bg-secondary border border-success/30 overflow-hidden mx-auto flex items-center justify-center">
                  <PetAvatar
                    photoUrl={petInfo.photoUrl}
                    name={petInfo.name}
                    className="h-full w-full object-cover"
                    iconClassName="h-8 w-8 text-muted-foreground"
                  />
                </div>

                <div>
                  <h2 className="text-xl font-display font-bold text-foreground">{petInfo.name}</h2>
                  <p className="text-sm font-medium text-success mt-1">Check-in Concluído</p>
                </div>

                {petTasks !== null && (
                  <div className="pt-2 border-t border-border mt-2 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Tarefas pendentes hoje</p>
                    {petTasks.length > 0 ? (
                      <div className="flex gap-1.5 justify-center flex-wrap">
                        {groupedPetTasks.map((item) => (
                          <Badge
                            key={item.type}
                            variant="secondary"
                            className="text-xs px-2 py-0.5"
                          >
                            {item.count}x {item.label}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Nenhuma tarefa pendente para hoje</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {scanState === "error" && (
              <div className="text-center p-6 space-y-4 w-full">
                <div className="h-16 w-16 rounded-full bg-destructive/20 border border-destructive/50 mx-auto flex items-center justify-center">
                  <XCircle className="h-8 w-8 text-destructive" />
                </div>
                <div>
                  <h2 className="text-lg font-display font-bold text-foreground">Ops, algo falhou</h2>
                  <p className="text-destructive-foreground text-sm mt-1 max-w-[240px] mx-auto">{errorMsg}</p>
                </div>
              </div>
            )}
          </div>

          {cameraError && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive-foreground flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
              <p className="leading-relaxed">{cameraError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-3">
            {(scanState === "idle" || scanState === "error") && (
              <Button size="lg" className="w-full text-[15px] h-12" onClick={startCamera}>
                <Camera className="mr-2 h-5 w-5" /> Escanear QR Code
              </Button>
            )}
            
            {scanState === "scanning" && (
              <Button variant="outline" size="lg" className="w-full h-12" onClick={reset}>
                Cancelar
              </Button>
            )}
            
            {scanState === "found" && (
              <div className="flex flex-col sm:flex-row gap-3">
                {canCheckIn && (
                  <Button
                    size="lg"
                    className="w-full h-12 sm:order-2"
                    onClick={handleCheckIn}
                    isLoading={checkInMutation.isPending}
                  >
                    <LogIn className="mr-2 h-5 w-5" /> Confirmar Check-in
                  </Button>
                )}
                {!canCheckIn && petInfo && (
                  <Button size="lg" variant="secondary" className="w-full h-12 sm:order-2" onClick={() => navigate(`/pets/${petInfo.id}`)}>
                    <Dog className="mr-2 h-5 w-5" /> Ver Perfil do Pet
                  </Button>
                )}
                <Button variant="outline" size="lg" className="w-full h-12 sm:order-1" onClick={reset}>
                  <RefreshCw className="mr-2 h-4 w-4 text-muted-foreground" /> Outro Pet
                </Button>
              </div>
            )}
            
            {scanState === "checking_in" && (
              <Button disabled size="lg" className="w-full h-12" isLoading>
                Realizando Check-in...
              </Button>
            )}
            
            {scanState === "checked_in" && (
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" className="w-full h-12 sm:order-2" onClick={reset}>
                  <Camera className="mr-2 h-5 w-5" /> Próximo Pet
                </Button>
                {petInfo && (
                  <Button variant="outline" size="lg" className="w-full h-12 sm:order-1" onClick={() => navigate(`/pets/${petInfo.id}`)}>
                    <Dog className="mr-2 h-5 w-5 text-muted-foreground" /> Ver Perfil
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/40 border-0 shadow-none">
        <CardContent className="p-5 text-[13px] text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Instruções Operacionais
          </p>
          <ul className="space-y-1.5 list-disc pl-4 marker:text-muted-foreground/40 leading-relaxed">
            <li>Toque em <span className="font-medium text-foreground">Escanear QR Code</span> para ativar a câmera traseira do dispositivo.</li>
            <li>Enquadre o código da coleira do pet dentro da área indicada na tela.</li>
            <li>Pets que não possuam uma reserva ativa para hoje não poderão realizar o check-in.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
