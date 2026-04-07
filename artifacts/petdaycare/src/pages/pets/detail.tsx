import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  useGetPet,
  useListVaccines,
  useListMedications,
  useListTimeline,
  useUpdatePet,
  useAddVaccine,
  useAddMedication,
  useAddTimelineEvent,
  useListBookings,
  useCheckIn,
  useListWalks,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Dog, Syringe, Activity, Clock, Plus, AlertCircle, LogIn, Camera, ImageIcon, X, Sparkles, QrCode, UtensilsCrossed, Footprints, Download, Navigation, Car, ExternalLink } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import QRCode from "qrcode";

export default function PetDetail({ id }: { id: number }) {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();

  const { data: pet, isLoading } = useGetPet(crecheId, id);
  const { data: bookings } = useListBookings(crecheId);
  const updatePetMutation = useUpdatePet();

  const [editOpen, setEditOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [onTheWayOpen, setOnTheWayOpen] = useState(false);
  const [eta, setEta] = useState("15");

  const onTheWayMutation = useMutation({
    mutationFn: async ({ bookingId, type, etaMinutes }: { bookingId: number; type: string; etaMinutes: number }) => {
      const token = localStorage.getItem("auth_token");
      const r = await fetch(`/api/creches/${crecheId}/bookings/${bookingId}/on-the-way`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, etaMinutes }),
      });
      if (!r.ok) throw new Error("Erro ao notificar");
      return r.json();
    },
    onSuccess: () => { setOnTheWayOpen(false); },
  });

  const handleEditProfile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    updatePetMutation.mutate(
      {
        crecheId,
        petId: id,
        data: {
          name: fd.get("name") as string,
          breed: (fd.get("breed") as string) || null,
          weight: fd.get("weight") ? Number(fd.get("weight")) : null,
          color: (fd.get("color") as string) || null,
          allergies: (fd.get("allergies") as string) || null,
          specialNeeds: (fd.get("specialNeeds") as string) || null,
          temperament: (fd.get("temperament") as any) || null,
        },
      },
      {
        onSuccess: () => {
          setEditOpen(false);
          queryClient.invalidateQueries();
        },
      }
    );
  };

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Carregando perfil do pet...</div>;
  if (!pet) return <div className="p-8 text-center text-destructive">Pet não encontrado.</div>;

  const confirmedBooking = bookings?.find((b) => b.petId === id && b.status === "confirmed");

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="glass-panel rounded-3xl p-6 md:p-8 flex flex-col md:flex-row gap-8 items-center md:items-start relative overflow-hidden">
        <div className="absolute right-0 top-0 w-1/3 h-full bg-gradient-to-l from-primary/20 to-transparent pointer-events-none" />

        <div className="h-32 w-32 md:h-40 md:w-40 rounded-full border-4 border-background bg-secondary relative z-10 shadow-[0_0_30px_rgba(139,92,246,0.3)] overflow-hidden flex-shrink-0">
          {pet.photoUrl ? (
            <img src={pet.photoUrl} alt={pet.name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-white/5">
              <Dog className="h-16 w-16 text-white/30" />
            </div>
          )}
        </div>

        <div className="flex-1 text-center md:text-left z-10">
          <div className="flex flex-col md:flex-row md:items-center gap-3 mb-2 justify-center md:justify-start">
            <h1 className="text-4xl font-display font-bold text-white tracking-tight">{pet.name}</h1>
            {pet.isCheckedIn ? (
              <Badge variant="success" className="w-max mx-auto md:mx-0">Presente</Badge>
            ) : (
              <Badge variant="secondary" className="w-max mx-auto md:mx-0">Em casa</Badge>
            )}
          </div>
          <p className="text-lg text-muted-foreground capitalize mb-4">
            {pet.breed || pet.species} • {pet.gender} • {pet.weight ? `${pet.weight} kg` : "Peso desconhecido"}
          </p>
          <div className="flex flex-wrap gap-2 justify-center md:justify-start">
            {pet.temperament && (
              <Badge variant="outline" className="capitalize bg-white/5">
                <Activity className="w-3 h-3 mr-1" /> {pet.temperament}
              </Badge>
            )}
            {pet.allergies && (
              <Badge variant="destructive" className="bg-destructive/20">
                <AlertCircle className="w-3 h-3 mr-1" /> Alergias
              </Badge>
            )}
            {pet.specialNeeds && (
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">
                <AlertCircle className="w-3 h-3 mr-1" /> Necessidades especiais
              </Badge>
            )}
          </div>
        </div>

        <div className="flex gap-2 z-10 w-full md:w-auto flex-wrap justify-center md:justify-end">
          <Button variant="glass" size="sm" onClick={() => setQrModalOpen(true)} className="gap-2">
            <QrCode className="h-4 w-4" />
            <span className="hidden sm:inline">QR Code</span>
          </Button>
          {confirmedBooking && (
            <Button
              variant="glass"
              size="sm"
              className="gap-2 border-blue-500/30 text-blue-300 hover:bg-blue-500/10"
              onClick={() => setOnTheWayOpen(true)}
            >
              <Navigation className="h-4 w-4" />
              <span className="hidden sm:inline">A Caminho</span>
            </Button>
          )}
          <Button variant="glass" size="sm" onClick={() => setEditOpen(true)} className="gap-2">
            <span className="sm:hidden">✏️</span>
            <span className="hidden sm:inline">Editar Perfil</span>
          </Button>
          {user?.role !== "tutor" && !pet.isCheckedIn && confirmedBooking && (
            <CheckInButton crecheId={crecheId} bookingId={confirmedBooking.id} />
          )}
        </div>
      </div>

      {/* On the Way Modal */}
      <Modal isOpen={onTheWayOpen} onClose={() => setOnTheWayOpen(false)} title={`Estou a Caminho — ${pet.name}`}>
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Avise a {user?.role === "tutor" ? "creche" : "equipe"} que você está a caminho.
          </p>
          <div className="space-y-2">
            <label className="text-sm font-medium">Previsão de chegada (minutos)</label>
            <Input
              type="number"
              min={1}
              max={120}
              value={eta}
              onChange={(e) => setEta(e.target.value)}
              placeholder="Ex: 15"
            />
          </div>
          <div className="flex flex-col sm:grid sm:grid-cols-2 gap-3">
            <Button
              onClick={() => confirmedBooking && onTheWayMutation.mutate({ bookingId: confirmedBooking.id, type: "drop_off", etaMinutes: Number(eta) })}
              isLoading={onTheWayMutation.isPending}
              className="bg-blue-600/80 hover:bg-blue-600 border-blue-500/30 w-full"
            >
              <Car className="mr-2 h-4 w-4" /> {user?.role === "tutor" ? "Levar o pet" : "Entregar o pet"}
            </Button>
            <Button
              onClick={() => confirmedBooking && onTheWayMutation.mutate({ bookingId: confirmedBooking.id, type: "pickup", etaMinutes: Number(eta) })}
              isLoading={onTheWayMutation.isPending}
              variant="outline"
              className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 w-full"
            >
              <Navigation className="mr-2 h-4 w-4" /> Buscar o pet
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setOnTheWayOpen(false)}>Cancelar</Button>
          </div>
        </div>
      </Modal>

      {/* QR Code Modal */}
      <Modal isOpen={qrModalOpen} onClose={() => setQrModalOpen(false)} title={`QR Code — ${pet.name}`}>
        <QrTab pet={pet} />
      </Modal>

      {/* Edit Modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Editar Perfil do Pet">
        <form onSubmit={handleEditProfile} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome</label>
              <Input name="name" defaultValue={pet.name} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Raça</label>
              <Input name="breed" defaultValue={pet.breed || ""} placeholder="Golden Retriever" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Peso (kg)</label>
              <Input name="weight" type="number" step="0.1" defaultValue={pet.weight || ""} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Cor</label>
              <Input name="color" defaultValue={pet.color || ""} placeholder="Caramelo" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Temperamento</label>
            <select name="temperament" defaultValue={pet.temperament || ""} className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md">
              <option value="">Selecione...</option>
              <option value="calm">Calmo</option>
              <option value="playful">Brincalhão</option>
              <option value="aggressive">Agressivo</option>
              <option value="shy">Tímido</option>
              <option value="sociable">Sociável</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Alergias</label>
            <Input name="allergies" defaultValue={pet.allergies || ""} placeholder="Ex: frango, pó..." />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Necessidades Especiais</label>
            <Input name="specialNeeds" defaultValue={pet.specialNeeds || ""} placeholder="Ex: ração medicamentosa..." />
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={updatePetMutation.isPending}>Salvar Alterações</Button>
          </div>
        </form>
      </Modal>

      {/* Tabs */}
      <Tabs
        defaultTab="overview"
        tabs={[
          { id: "overview", label: "Visão Geral", content: <OverviewTab pet={pet} crecheId={crecheId} petId={id} /> },
          { id: "plan", label: "Plano", icon: <UtensilsCrossed className="h-4 w-4" />, content: <PlanTab pet={pet} crecheId={crecheId} petId={id} /> },
          { id: "medical", label: "Saúde", icon: <Syringe className="h-4 w-4" />, content: <MedicalTab crecheId={crecheId} petId={id} /> },
          { id: "timeline", label: "Linha do Tempo", icon: <Clock className="h-4 w-4" />, content: <TimelineTab crecheId={crecheId} petId={id} /> },
          { id: "qr", label: "QR Code", icon: <QrCode className="h-4 w-4" />, content: <QrTab pet={pet} /> },
        ]}
      />
    </div>
  );
}

function CheckInButton({ crecheId, bookingId }: { crecheId: number; bookingId: number }) {
  const checkInMutation = useCheckIn();
  const queryClient = useQueryClient();

  return (
    <Button
      onClick={() =>
        checkInMutation.mutate(
          { crecheId, bookingId, data: {} },
          { onSuccess: () => queryClient.invalidateQueries() }
        )
      }
      isLoading={checkInMutation.isPending}
      className="shadow-[0_0_20px_rgba(139,92,246,0.4)]"
    >
      <LogIn className="mr-2 h-4 w-4" /> Check-in
    </Button>
  );
}

function QrTab({ pet }: { pet: any }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pet?.qrToken || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, pet.qrToken, {
      width: 280,
      margin: 2,
      color: { dark: "#ffffff", light: "#12091f" },
    });
    QRCode.toDataURL(pet.qrToken, {
      width: 600,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, [pet?.qrToken]);

  if (!pet?.qrToken) {
    return (
      <div className="max-w-sm mx-auto text-center py-12 text-muted-foreground">
        <QrCode className="h-12 w-12 mx-auto mb-4 opacity-30" />
        <p>QR Code não disponível para este pet.</p>
      </div>
    );
  }

  const handleDownload = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `qr-${pet.name.toLowerCase().replace(/\s/g, "-")}.png`;
    a.click();
  };

  return (
    <div className="max-w-sm mx-auto">
      <Card>
        <CardContent className="p-8 flex flex-col items-center gap-6">
          <div>
            <h3 className="text-xl font-display font-semibold text-white text-center">{pet.name}</h3>
            <p className="text-sm text-muted-foreground text-center mt-1">QR Code de Identificação</p>
          </div>

          <div className="p-4 rounded-2xl bg-[#12091f] border border-primary/20 shadow-[0_0_30px_rgba(139,92,246,0.2)]">
            <canvas ref={canvasRef} className="rounded-xl" />
          </div>

          <div className="w-full space-y-3">
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
              <p className="text-xs text-muted-foreground mb-1">Token de Identificação</p>
              <p className="text-xs font-mono text-primary break-all">{pet.qrToken}</p>
            </div>
            <Button className="w-full" variant="outline" onClick={handleDownload} disabled={!qrDataUrl}>
              <Download className="mr-2 h-4 w-4" /> Baixar QR Code
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Imprima e fixe na coleira do pet. A staff pode escanear para identificação rápida.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlanTab({ pet, crecheId, petId }: { pet: any; crecheId: number; petId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const updatePetMutation = useUpdatePet();
  const canEdit = user?.role !== "tutor";

  const [saved, setSaved] = useState(false);

  const defaultFeedingSchedule = [
    { time: "08:00", amount: "1 xícara", notes: "" },
    { time: "18:00", amount: "1 xícara", notes: "" },
  ];
  const defaultWalkSchedule = [
    { time: "07:00", durationMinutes: 30, notes: "" },
    { time: "17:00", durationMinutes: 30, notes: "" },
  ];

  const feedingSchedule: Array<{ time: string; amount: string; notes?: string }> =
    pet?.feedingSchedule && Array.isArray(pet.feedingSchedule) ? pet.feedingSchedule : defaultFeedingSchedule;
  const walkSchedule: Array<{ time: string; durationMinutes: number; notes?: string }> =
    pet?.walkSchedule && Array.isArray(pet.walkSchedule) ? pet.walkSchedule : defaultWalkSchedule;

  const [editFeeding, setEditFeeding] = useState<Array<{ time: string; amount: string; foodName: string; notes: string }>>(
    feedingSchedule.map((f) => ({ ...f, foodName: (f as any).foodName || "", notes: f.notes || "" }))
  );
  const [editWalk, setEditWalk] = useState<Array<{ time: string; durationMinutes: number; notes: string }>>(
    walkSchedule.map((w) => ({ ...w, notes: w.notes || "" }))
  );

  const handleSave = () => {
    updatePetMutation.mutate(
      {
        crecheId,
        petId,
        data: {
          feedingSchedule: editFeeding as any,
          walkSchedule: editWalk as any,
        },
      },
      {
        onSuccess: () => {
          setSaved(true);
          queryClient.invalidateQueries();
          setTimeout(() => setSaved(false), 3000);
        },
      }
    );
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Feeding Schedule */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-orange-500/20 flex items-center justify-center">
                <UtensilsCrossed className="h-4 w-4 text-orange-400" />
              </div>
              <h3 className="text-lg font-display font-semibold text-white">Alimentação</h3>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditFeeding([...editFeeding, { time: "12:00", amount: "", notes: "" }])}
              >
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {editFeeding.map((item, i) => (
              <div key={i} className="flex gap-3 p-4 rounded-xl bg-white/5 border border-white/10 items-start">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Horário</label>
                    <Input
                      type="time"
                      value={item.time}
                      onChange={(e) => {
                        const copy = [...editFeeding];
                        copy[i] = { ...copy[i], time: e.target.value };
                        setEditFeeding(copy);
                      }}
                      disabled={!canEdit}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Quantidade</label>
                    <Input
                      value={item.amount}
                      onChange={(e) => {
                        const copy = [...editFeeding];
                        copy[i] = { ...copy[i], amount: e.target.value };
                        setEditFeeding(copy);
                      }}
                      disabled={!canEdit}
                      placeholder="Ex: 1 xícara"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs text-muted-foreground">Nome da ração</label>
                    <Input
                      value={(item as any).foodName || ""}
                      onChange={(e) => {
                        const copy = [...editFeeding];
                        copy[i] = { ...copy[i], foodName: e.target.value };
                        setEditFeeding(copy);
                      }}
                      disabled={!canEdit}
                      placeholder="Ex: Royal Canin Medium Adult"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs text-muted-foreground">Observações</label>
                    <Input
                      value={item.notes}
                      onChange={(e) => {
                        const copy = [...editFeeding];
                        copy[i] = { ...copy[i], notes: e.target.value };
                        setEditFeeding(copy);
                      }}
                      disabled={!canEdit}
                      placeholder="Ex: evitar ração com frango"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditFeeding(editFeeding.filter((_, j) => j !== i))}
                    className="h-7 w-7 rounded-full bg-red-500/10 flex items-center justify-center hover:bg-red-500/20 text-red-400 transition-colors mt-6"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {editFeeding.length === 0 && (
              <div className="text-center py-6 text-muted-foreground text-sm">Nenhum horário de alimentação configurado.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Walk Schedule */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-green-500/20 flex items-center justify-center">
                <Footprints className="h-4 w-4 text-green-400" />
              </div>
              <h3 className="text-lg font-display font-semibold text-white">Passeios</h3>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditWalk([...editWalk, { time: "12:00", durationMinutes: 30, notes: "" }])}
              >
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {editWalk.map((item, i) => (
              <div key={i} className="flex gap-3 p-4 rounded-xl bg-white/5 border border-white/10 items-start">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Horário</label>
                    <Input
                      type="time"
                      value={item.time}
                      onChange={(e) => {
                        const copy = [...editWalk];
                        copy[i] = { ...copy[i], time: e.target.value };
                        setEditWalk(copy);
                      }}
                      disabled={!canEdit}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Duração (min)</label>
                    <Input
                      type="number"
                      min={5}
                      max={180}
                      value={item.durationMinutes}
                      onChange={(e) => {
                        const copy = [...editWalk];
                        copy[i] = { ...copy[i], durationMinutes: Number(e.target.value) };
                        setEditWalk(copy);
                      }}
                      disabled={!canEdit}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label className="text-xs text-muted-foreground">Notas</label>
                    <Input
                      value={item.notes}
                      onChange={(e) => {
                        const copy = [...editWalk];
                        copy[i] = { ...copy[i], notes: e.target.value };
                        setEditWalk(copy);
                      }}
                      disabled={!canEdit}
                      placeholder="Ex: evitar sol forte"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditWalk(editWalk.filter((_, j) => j !== i))}
                    className="h-7 w-7 rounded-full bg-red-500/10 flex items-center justify-center hover:bg-red-500/20 text-red-400 transition-colors mt-6"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {editWalk.length === 0 && (
              <div className="text-center py-6 text-muted-foreground text-sm">Nenhum horário de passeio configurado.</div>
            )}
          </div>
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex items-center gap-4">
          <Button onClick={handleSave} isLoading={updatePetMutation.isPending}>
            Salvar Plano
          </Button>
          {saved && (
            <p className="text-sm text-emerald-400">✓ Plano salvo com sucesso</p>
          )}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ pet, crecheId, petId }: { pet: any; crecheId: number; petId: number }) {
  const { data: walks } = useListWalks(crecheId, petId);
  const recentWalks = walks?.slice(0, 4) ?? [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardContent className="p-6 space-y-5">
          <h3 className="text-lg font-display font-semibold border-b border-white/10 pb-2">Informações Gerais</h3>
          <div className="grid grid-cols-2 gap-y-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Tutor</p>
              <p className="font-medium text-white">{pet.tutorName || "Sem tutor"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Data de Nascimento</p>
              <p className="font-medium text-white">{pet.birthDate ? format(new Date(pet.birthDate), "dd/MM/yyyy") : "Desconhecida"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Cor</p>
              <p className="font-medium text-white capitalize">{pet.color || "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Status</p>
              <p className="font-medium text-white capitalize">{pet.status}</p>
            </div>
          </div>
          {pet.allergies && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20">
              <p className="text-sm font-medium text-red-400 mb-1">⚠ Alergias</p>
              <p className="text-sm text-muted-foreground">{pet.allergies}</p>
            </div>
          )}
          {pet.specialNeeds && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm font-medium text-amber-400 mb-1">⚠ Necessidades Especiais</p>
              <p className="text-sm text-muted-foreground">{pet.specialNeeds}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="text-lg font-display font-semibold border-b border-white/10 pb-2 mb-4">Alimentação</h3>
          {Array.isArray(pet.feedingSchedule) && pet.feedingSchedule.length > 0 ? (
            <div className="space-y-2.5 text-sm">
              {pet.feedingSchedule.map((item: any, i: number) => (
                <div key={i} className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-white">🕐 {item.time}</span>
                    <span className="text-primary font-medium">{item.amount}</span>
                  </div>
                  {item.foodName && (
                    <p className="text-xs text-muted-foreground">🍽️ {item.foodName}</p>
                  )}
                  {item.notes && (
                    <p className="text-xs text-muted-foreground mt-0.5">📝 {item.notes}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">Nenhum horário de alimentação configurado.</div>
          )}
        </CardContent>
      </Card>

      {/* Últimos Passeios — full width */}
      <Card className="md:col-span-2">
        <CardContent className="p-6">
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-4">
            <h3 className="text-lg font-display font-semibold flex items-center gap-2">
              <Footprints className="h-5 w-5 text-primary" />
              Últimos Passeios
            </h3>
            {recentWalks.length > 0 && (
              <Badge variant="secondary" className="text-xs">{walks?.length ?? 0} total</Badge>
            )}
          </div>
          {recentWalks.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {recentWalks.map((walk: any) => {
                const durationMs = walk.endedAt
                  ? new Date(walk.endedAt).getTime() - new Date(walk.startedAt).getTime()
                  : null;
                const durationMin = durationMs != null ? Math.round(durationMs / 60000) : null;
                return (
                  <div key={walk.id} className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Footprints className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{walk.staffName || "Staff"}</p>
                        <p className="text-xs text-muted-foreground">
                          {walk.startedAt && !isNaN(new Date(walk.startedAt).getTime())
                            ? format(new Date(walk.startedAt), "dd/MM/yy HH:mm", { locale: ptBR })
                            : "—"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <Badge variant={walk.endedAt ? "success" : "secondary"} className="text-xs">
                        {walk.endedAt ? "Concluído" : "Em andamento"}
                      </Badge>
                      {durationMin != null && (
                        <p className="text-xs text-muted-foreground mt-1">{durationMin} min</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-4 text-center">Nenhum passeio registrado para este pet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MedicalTab({ crecheId, petId }: { crecheId: number; petId: number }) {
  const queryClient = useQueryClient();
  const { data: vaccines } = useListVaccines(crecheId, petId);
  const { data: medications } = useListMedications(crecheId, petId);
  const addVaccineMutation = useAddVaccine();
  const addMedMutation = useAddMedication();

  const [vaccineOpen, setVaccineOpen] = useState(false);
  const [medOpen, setMedOpen] = useState(false);
  const [vaccinePhoto, setVaccinePhoto] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const vaccinePhotoRef = useRef<HTMLInputElement>(null);

  const handleVaccinePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Foto deve ter no máximo 5MB"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setVaccinePhoto(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleAddVaccine = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    addVaccineMutation.mutate(
      {
        crecheId,
        petId,
        data: {
          name: fd.get("name") as string,
          appliedDate: fd.get("appliedDate") as string,
          nextDueDate: (fd.get("nextDueDate") as string) || null,
          veterinarian: (fd.get("veterinarian") as string) || null,
          notes: (fd.get("notes") as string) || null,
          receiptUrl: vaccinePhoto || null,
        },
      },
      {
        onSuccess: () => {
          setVaccineOpen(false);
          setVaccinePhoto(null);
          queryClient.invalidateQueries();
        },
      }
    );
  };

  const handleAddMed = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const timesRaw = fd.get("times") as string;
    addMedMutation.mutate(
      {
        crecheId,
        petId,
        data: {
          name: fd.get("name") as string,
          dosage: fd.get("dosage") as string,
          frequency: fd.get("frequency") as string,
          startDate: fd.get("startDate") as string,
          endDate: (fd.get("endDate") as string) || null,
          times: timesRaw ? timesRaw.split(",").map((t) => t.trim()) : [],
          notes: (fd.get("notes") as string) || null,
        },
      },
      {
        onSuccess: () => {
          setMedOpen(false);
          queryClient.invalidateQueries();
        },
      }
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Vaccines */}
      <Card>
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
            <h3 className="text-lg font-display font-semibold">Vacinas</h3>
            <Button variant="outline" size="sm" onClick={() => setVaccineOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Adicionar
            </Button>
          </div>
          {vaccines?.length ? (
            <div className="space-y-3">
              {vaccines.map((v) => (
                <div key={v.id} className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                  {v.receiptUrl && (
                    <button
                      type="button"
                      className="w-full block"
                      onClick={() => setLightboxUrl(v.receiptUrl!)}
                    >
                      <img
                        src={v.receiptUrl}
                        alt="Carteirinha"
                        className="w-full h-28 object-cover border-b border-white/10 hover:opacity-90 transition-opacity"
                      />
                    </button>
                  )}
                  <div className="p-3 flex justify-between items-center gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white">{v.name}</p>
                        {v.receiptUrl && (
                          <span className="text-xs text-primary flex items-center gap-0.5"><Camera className="h-3 w-3" /> foto</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">Aplicada: {format(new Date(v.appliedDate), "dd/MM/yyyy")}</p>
                      {v.veterinarian && <p className="text-xs text-muted-foreground">Dr. {v.veterinarian}</p>}
                    </div>
                    {v.nextDueDate && (
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-muted-foreground">Próxima</p>
                        <p className="text-sm font-medium text-amber-400">{format(new Date(v.nextDueDate), "dd/MM/yyyy")}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Syringe} title="Sem vacinas" description="Nenhum registro de vacina encontrado." />
          )}
          {/* Lightbox */}
          {lightboxUrl && (
            <div
              className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setLightboxUrl(null)}
            >
              <div className="relative max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
                <button
                  className="absolute -top-10 right-0 text-white/70 hover:text-white text-sm"
                  onClick={() => setLightboxUrl(null)}
                >
                  ✕ Fechar
                </button>
                <img src={lightboxUrl} alt="Carteirinha de vacina" className="w-full rounded-2xl shadow-2xl" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Medications */}
      <Card>
        <CardContent className="p-6">
          <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
            <h3 className="text-lg font-display font-semibold">Medicamentos</h3>
            <Button variant="outline" size="sm" onClick={() => setMedOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Adicionar
            </Button>
          </div>
          {medications?.length ? (
            <div className="space-y-3">
              {medications.map((m) => (
                <div key={m.id} className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <div className="flex justify-between items-start mb-1">
                    <p className="font-medium text-white">{m.name}</p>
                    <Badge variant={m.isActive ? "success" : "secondary"}>{m.isActive ? "Ativo" : "Inativo"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{m.dosage} • {m.frequency}</p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {m.times?.map((t: string) => (
                      <Badge key={t} variant="outline" className="bg-black/40 text-xs">{t}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Activity} title="Sem medicamentos" description="Nenhum medicamento registrado." />
          )}
        </CardContent>
      </Card>

      {/* Add Vaccine Modal */}
      <Modal isOpen={vaccineOpen} onClose={() => { setVaccineOpen(false); setVaccinePhoto(null); }} title="Adicionar Vacina">
        <form onSubmit={handleAddVaccine} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome da Vacina</label>
            <Input name="name" required placeholder="V8, Raiva, Giárdia..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Data de Aplicação</label>
              <Input name="appliedDate" type="date" required defaultValue={format(new Date(), "yyyy-MM-dd")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Próxima Dose</label>
              <Input name="nextDueDate" type="date" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Veterinário</label>
            <Input name="veterinarian" placeholder="Dr. Silva" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Observações</label>
            <Input name="notes" placeholder="Notas adicionais..." />
          </div>
          {/* Vaccine photo / certificate */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Foto da Carteirinha</label>
            <input
              type="file"
              ref={vaccinePhotoRef}
              onChange={handleVaccinePhotoChange}
              accept="image/*"
              capture="environment"
              className="hidden"
            />
            {vaccinePhoto ? (
              <div className="relative rounded-xl overflow-hidden border border-white/10">
                <img src={vaccinePhoto} alt="Carteirinha" className="w-full h-32 object-cover" />
                <button
                  type="button"
                  onClick={() => setVaccinePhoto(null)}
                  className="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
                <div className="absolute bottom-2 left-2 text-xs text-white/70 bg-black/50 px-2 py-0.5 rounded-full">
                  foto selecionada
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => vaccinePhotoRef.current?.click()}
              >
                <Camera className="mr-2 h-4 w-4" /> Tirar foto ou escolher arquivo
              </Button>
            )}
          </div>
          <div className="pt-2 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => { setVaccineOpen(false); setVaccinePhoto(null); }}>Cancelar</Button>
            <Button type="submit" isLoading={addVaccineMutation.isPending}>Salvar Vacina</Button>
          </div>
        </form>
      </Modal>

      {/* Add Medication Modal */}
      <Modal isOpen={medOpen} onClose={() => setMedOpen(false)} title="Adicionar Medicamento">
        <form onSubmit={handleAddMed} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome</label>
            <Input name="name" required placeholder="Frontline, Heartgard..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Dosagem</label>
              <Input name="dosage" required placeholder="10mg" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Frequência</label>
              <Input name="frequency" required placeholder="Diário" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Início</label>
              <Input name="startDate" type="date" required defaultValue={format(new Date(), "yyyy-MM-dd")} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Fim</label>
              <Input name="endDate" type="date" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Horários (separados por vírgula)</label>
            <Input name="times" placeholder="08:00, 20:00" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Observações</label>
            <Input name="notes" placeholder="Dar com alimento..." />
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setMedOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={addMedMutation.isPending}>Salvar Medicamento</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

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

const AVATAR_COLORS = [
  "bg-violet-600","bg-blue-600","bg-emerald-600","bg-orange-600","bg-pink-600","bg-cyan-600",
];
function avatarColor(name: string) {
  let h = 0;
  for (const c of name || "") h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

async function compressImage(file: File, maxWidth = 1080, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = ev.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function FeedCard({ event }: { event: any }) {
  const [expanded, setExpanded] = useState(false);
  const meta = EVENT_META[event.type] || { emoji: "📌", label: event.type, color: "bg-white/10 text-white border-white/10" };
  const date = new Date(event.createdAt);
  const relTime = formatDistanceToNow(date, { addSuffix: true, locale: ptBR });

  return (
    <div className="glass-panel rounded-2xl overflow-hidden border border-white/8 shadow-[0_4px_32px_rgba(0,0,0,0.4)] animate-in fade-in slide-in-from-bottom-2 duration-400">
      {/* Photo */}
      {event.mediaUrl && (
        <div className="w-full bg-black/40 max-h-[520px] overflow-hidden">
          <img
            src={event.mediaUrl}
            alt="Foto do evento"
            className="w-full object-cover max-h-[520px]"
            loading="lazy"
          />
        </div>
      )}

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* Author row */}
        <div className="flex items-center gap-3">
          <div className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${avatarColor(event.authorName || "")}`}>
            {getInitials(event.authorName || "?")}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-tight truncate">{event.authorName || "Staff"}</p>
            <p className="text-xs text-muted-foreground">{relTime}</p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${meta.color} flex-shrink-0`}>
            {meta.emoji} {meta.label}
          </span>
        </div>

        {/* Caption */}
        {event.content && (
          <div className="text-sm text-gray-200 leading-relaxed">
            {event.content.length > 180 && !expanded ? (
              <>
                {event.content.slice(0, 180)}…{" "}
                <button onClick={() => setExpanded(true)} className="text-primary font-medium hover:underline">ver mais</button>
              </>
            ) : (
              event.content
            )}
          </div>
        )}

        {/* Date */}
        <p className="text-xs text-white/30 pt-1">{format(date, "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}</p>
      </div>
    </div>
  );
}

function TimelineTab({ crecheId, petId }: { crecheId: number; petId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: timeline } = useListTimeline(crecheId, petId);
  const addEventMutation = useAddTimelineEvent();
  const [postOpen, setPostOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [selectedType, setSelectedType] = useState("photo");
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaDataRef = useRef<string | null>(null);

  const canPost = user?.role !== "tutor";

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    try {
      const data = await compressImage(file);
      mediaDataRef.current = data;
      setPreview(data);
    } catch {
      mediaDataRef.current = null;
      setPreview(null);
    } finally {
      setCompressing(false);
    }
  }, []);

  const handlePost = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    addEventMutation.mutate(
      {
        crecheId,
        petId,
        data: {
          type: selectedType as any,
          content: (fd.get("content") as string) || null,
          mediaUrl: mediaDataRef.current || null,
          mediaType: mediaDataRef.current ? "photo" : undefined,
        },
      },
      {
        onSuccess: () => {
          setPostOpen(false);
          setPreview(null);
          mediaDataRef.current = null;
          setSelectedType("photo");
          queryClient.invalidateQueries();
        },
      }
    );
  };

  const closeModal = () => {
    setPostOpen(false);
    setPreview(null);
    mediaDataRef.current = null;
    setSelectedType("photo");
  };

  const eventTypes = [
    { value: "photo", emoji: "📸", label: "Foto" },
    { value: "note", emoji: "📝", label: "Nota" },
    { value: "play", emoji: "🎾", label: "Brincadeira" },
    { value: "walk", emoji: "🦮", label: "Passeio" },
    { value: "feeding", emoji: "🍽️", label: "Alimentação" },
    { value: "medication", emoji: "💊", label: "Medicação" },
    { value: "health", emoji: "🏥", label: "Saúde" },
  ];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Compose bar (staff/admin only) */}
      {canPost && (
        <button
          onClick={() => setPostOpen(true)}
          className="w-full glass-panel rounded-2xl p-4 flex items-center gap-4 border border-white/8 hover:border-primary/40 hover:bg-white/5 transition-all text-left group"
        >
          <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/30 transition-colors">
            <Camera className="h-5 w-5 text-primary" />
          </div>
          <span className="text-muted-foreground text-sm flex-1">Publicar uma atualização sobre este pet...</span>
          <div className="flex items-center gap-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity">
            <Sparkles className="h-4 w-4" />
          </div>
        </button>
      )}

      {/* Feed */}
      {timeline?.length ? (
        <div className="space-y-5">
          {timeline.map((event) => (
            <FeedCard key={event.id} event={event} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ImageIcon}
          title="Nenhuma publicação ainda"
          description={canPost ? "Publique a primeira foto ou atualização do pet." : "A equipe ainda não publicou nenhuma atualização."}
          action={canPost ? { label: "Publicar Primeira Foto", onClick: () => setPostOpen(true) } : undefined}
        />
      )}

      {/* Compose Modal */}
      <Modal isOpen={postOpen} onClose={closeModal} title="Nova Publicação">
        <form onSubmit={handlePost} className="space-y-5">
          {/* Type chips */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Tipo de Evento</label>
            <div className="flex flex-wrap gap-2">
              {eventTypes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setSelectedType(t.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    selectedType === t.value
                      ? "bg-primary text-white border-primary shadow-[0_0_12px_rgba(139,92,246,0.5)]"
                      : "bg-white/5 text-white/60 border-white/10 hover:bg-white/10"
                  }`}
                >
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Photo upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Foto (opcional)</label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            {/* Hidden camera-capture input */}
            <input
              id="camera-capture-input"
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />
            {preview ? (
              <div className="relative rounded-xl overflow-hidden border border-white/10">
                <img src={preview} alt="Preview" className="w-full max-h-64 object-cover" />
                <button
                  type="button"
                  onClick={() => { setPreview(null); mediaDataRef.current = null; if (fileRef.current) fileRef.current.value = ""; }}
                  className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/70 flex items-center justify-center hover:bg-black/90 transition-colors"
                >
                  <X className="h-4 w-4 text-white" />
                </button>
              </div>
            ) : compressing ? (
              <div className="w-full h-28 rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center">
                <div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="h-24 rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-2 text-white/40 hover:border-primary/50 hover:text-primary/70 hover:bg-primary/5 transition-all"
                >
                  <ImageIcon className="h-6 w-6" />
                  <span className="text-xs">Galeria</span>
                </button>
                <button
                  type="button"
                  onClick={() => document.getElementById("camera-capture-input")?.click()}
                  className="h-24 rounded-xl border-2 border-dashed border-white/15 flex flex-col items-center justify-center gap-2 text-white/40 hover:border-primary/50 hover:text-primary/70 hover:bg-primary/5 transition-all"
                >
                  <Camera className="h-6 w-6" />
                  <span className="text-xs">Câmera</span>
                </button>
              </div>
            )}
          </div>

          {/* Caption */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Legenda</label>
            <textarea
              name="content"
              rows={4}
              placeholder="Escreva uma legenda para este momento especial..."
              className="flex w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md resize-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={closeModal}>Cancelar</Button>
            <Button type="submit" isLoading={addEventMutation.isPending} className="shadow-[0_0_16px_rgba(139,92,246,0.4)]">
              <Sparkles className="h-4 w-4 mr-2" /> Publicar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
