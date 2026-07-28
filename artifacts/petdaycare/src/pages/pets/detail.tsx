import React, { useState, useRef, useCallback } from "react";
import {
  useGetPet,
  useUpdatePet,
  useListBookings,
  useCheckIn,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { resolvePhotoUrl, uploadFileDirect } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useTutorInvoices } from "@/hooks/use-financial";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Dog, Syringe, Activity, Clock, AlertCircle, LogIn, Camera, QrCode, UtensilsCrossed, Navigation, Car } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";

import { OverviewTab } from "./components/overview-tab";
import { PlanTab } from "./components/plan-tab";
import { QrTab } from "./components/qr-tab";
import { MedicalTab } from "./components/medical-tab";

const speciesMap: Record<string, string> = { dog: 'Cachorro', cat: 'Gato', bird: 'Pássaro', other: 'Outro' };
const genderMap: Record<string, string> = { male: "Macho", female: "Fêmea", unknown: "Desconhecido" };
const temperamentMap: Record<string, string> = { calm: "Calmo", playful: "Brincalhão", aggressive: "Agressivo", shy: "Tímido", sociable: "Sociável" };

export default function PetDetail({ id }: { id: number }) {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();

  const { data: pet, isLoading } = useGetPet(crecheId, id);
  const { data: bookingsResponse } = useListBookings(crecheId);
  const bookings = (bookingsResponse as any)?.items;
  const updatePetMutation = useUpdatePet();
  const { data: tutorInvoicesData } = useTutorInvoices(crecheId, pet?.tutorId);
  const tutorInvoices = Array.isArray(tutorInvoicesData) 
    ? tutorInvoicesData 
    : (tutorInvoicesData as any)?.data ?? (tutorInvoicesData as any)?.items ?? [];

  const [editOpen, setEditOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [onTheWayOpen, setOnTheWayOpen] = useState(false);
  const [eta, setEta] = useState("15");
  const { toast } = useToast();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const token = localStorage.getItem("auth_token") ?? "";
      const objectPath = await uploadFileDirect(file, token);
      updatePetMutation.mutate(
        { crecheId, petId: id, data: { photoUrl: objectPath } },
        {
          onSuccess: () => { queryClient.invalidateQueries(); },
          onError: () => {
            toast({ title: "Erro ao salvar foto", description: "Tente novamente.", variant: "destructive" });
          },
          onSettled: () => { setUploadingPhoto(false); },
        }
      );
    } catch (err: any) {
      setUploadingPhoto(false);
      toast({
        title: "Erro ao enviar foto",
        description: err?.message ?? "Não foi possível fazer o upload. Tente novamente.",
        variant: "destructive",
      });
    }
    if (photoInputRef.current) photoInputRef.current.value = "";
  }, [crecheId, id, updatePetMutation, queryClient, toast]);

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
    onError: (err: any) => {
      toast({ title: "Erro ao notificar tutor", description: err?.message ?? "Tente novamente.", variant: "destructive" });
    },
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
          birthDate: (fd.get("birthDate") as string) || null,
          weight: fd.get("weight") ? Number(fd.get("weight")) : null,
          color: (fd.get("color") as string) || null,
          allergies: (fd.get("allergies") as string) || null,
          specialNeeds: (fd.get("specialNeeds") as string) || null,
          temperament: (fd.get("temperament") as any) || null,
          isCastrated: fd.get("isCastrated") === "on",
        } as any,
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

  const safeBookings = Array.isArray(bookings)
    ? bookings
    : (bookings as any)?.data ?? (bookings as any)?.bookings ?? [];
  const confirmedBooking = safeBookings.find((b: any) => b.petId === id && b.status === "confirmed");

  return (
    <div className="space-y-6 pb-24 md:pb-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()} className="rounded-full hover:bg-white/10">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
        </Button>
        <span className="text-sm text-muted-foreground font-medium">Voltar</span>
      </div>

      {/* Header */}
      <div className="glass-panel rounded-3xl p-6 md:p-8 flex flex-col md:flex-row gap-8 items-center md:items-start relative overflow-hidden">
        <div className="absolute right-0 top-0 w-1/3 h-full bg-gradient-to-l from-primary/20 to-transparent pointer-events-none" />

        {/* Clickable pet avatar for photo upload */}
        <div
          className="h-32 w-32 md:h-40 md:w-40 rounded-full border-4 border-background bg-secondary relative z-10 shadow-[0_0_30px_rgba(139,92,246,0.3)] overflow-hidden flex-shrink-0 cursor-pointer group/avatar"
          onClick={() => photoInputRef.current?.click()}
          title="Clique para trocar a foto"
        >
          {uploadingPhoto ? (
            <div className="h-full w-full flex items-center justify-center bg-black/60">
              <div className="animate-spin h-8 w-8 rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : pet.photoUrl ? (
            <img src={resolvePhotoUrl(pet.photoUrl)!} alt={pet.name} className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-white/5">
              <Dog className="h-16 w-16 text-white/30" />
            </div>
          )}
          {/* Hover overlay */}
          {!uploadingPhoto && (
            <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity">
              <Camera className="h-8 w-8 text-white mb-1" />
              <span className="text-xs text-white font-medium">Trocar foto</span>
            </div>
          )}
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePhotoUpload}
        />

        <div className="flex-1 text-center md:text-left z-10">
          <div className="flex flex-col md:flex-row md:items-center gap-3 mb-2 justify-center md:justify-start">
            <h1 className="text-4xl font-display font-bold text-white tracking-tight">{pet.name}</h1>
            {pet.isCheckedIn ? (
              <Badge variant="success" className="w-max mx-auto md:mx-0">Presente</Badge>
            ) : (
              <Badge variant="secondary" className="w-max mx-auto md:mx-0">Em casa</Badge>
            )}
            {user?.role !== "tutor" && tutorInvoices?.some((inv: any) => inv.status === "overdue") && (
              <Badge variant="destructive" className="w-max mx-auto md:mx-0">Inadimplente</Badge>
            )}
            {user?.role !== "tutor" && tutorInvoices && !tutorInvoices.some((inv: any) => inv.status === "overdue") && (
              <Badge variant="success" className="w-max mx-auto md:mx-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Adimplente</Badge>
            )}
          </div>
          <p className="text-lg text-muted-foreground capitalize mb-4">
            {pet.breed || speciesMap[pet.species] || pet.species} • {genderMap[pet.gender] || pet.gender} • {pet.weight ? `${pet.weight} kg` : "Peso desconhecido"}
          </p>
          <div className="flex flex-wrap gap-2 justify-center md:justify-start mb-2">
            {pet.weight && (
              <Badge className="bg-white/10 text-white hover:bg-white/20">
                Porte {pet.weight < 10 ? "Pequeno" : pet.weight < 25 ? "Médio" : "Grande"}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2 justify-center md:justify-start">
            {pet.temperament && (
              <Badge variant="outline" className="capitalize bg-white/5">
                <Activity className="w-3 h-3 mr-1" /> {temperamentMap[pet.temperament] || pet.temperament}
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
            <Badge variant="outline" className={(pet as any).isCastrated ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-white/5 text-muted-foreground"}>
              {(pet as any).isCastrated ? "✓ Castrado" : "Não castrado"}
            </Badge>
          </div>
        </div>

        <div className="hidden md:flex gap-2 z-10 w-auto flex-wrap justify-end ml-auto">
          <Button variant="glass" size="sm" onClick={() => setQrModalOpen(true)} className="gap-2">
            <QrCode className="h-4 w-4" />
            <span>QR Code</span>
          </Button>
          {confirmedBooking && (
            <Button
              variant="glass"
              size="sm"
              className="gap-2 border-blue-500/30 text-blue-300 hover:bg-blue-500/10"
              onClick={() => setOnTheWayOpen(true)}
            >
              <Navigation className="h-4 w-4" />
              <span>A Caminho</span>
            </Button>
          )}
          <Button variant="glass" size="sm" onClick={() => setEditOpen(true)} className="gap-2">
            <span>Editar Perfil</span>
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
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Editar Perfil do Pet" className="max-w-2xl">
        <form onSubmit={handleEditProfile} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome</label>
              <Input name="name" defaultValue={pet.name} required />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Raça</label>
              <Input name="breed" defaultValue={pet.breed || ""} placeholder="Golden Retriever" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Nascimento</label>
              <Input name="birthDate" type="date" defaultValue={pet.birthDate ? pet.birthDate.split('T')[0] : ""} className="h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2" />
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
            <select name="temperament" defaultValue={pet.temperament || ""} className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-base text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md">
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
          <label className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer hover:bg-white/8 transition-colors">
            <input type="checkbox" name="isCastrated" defaultChecked={!!(pet as any).isCastrated} className="h-4 w-4 rounded accent-primary" />
            <div>
              <p className="text-sm font-medium text-white">Castrado(a)</p>
              <p className="text-xs text-muted-foreground">Marque se o pet já foi castrado</p>
            </div>
          </label>
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={updatePetMutation.isPending}>Salvar Alterações</Button>
          </div>
        </form>
      </Modal>

      {/* Desktop Tabs */}
      <div className="hidden md:block">
        <Tabs
          defaultTab="overview"
          tabs={[
            { id: "overview", label: "Visão Geral", content: <OverviewTab pet={pet} crecheId={crecheId} petId={id} /> },
            { id: "plan", label: "Plano", icon: <UtensilsCrossed className="h-4 w-4" />, content: <PlanTab pet={pet} crecheId={crecheId} petId={id} /> },
            { id: "medical", label: "Saúde", icon: <Syringe className="h-4 w-4" />, content: <MedicalTab crecheId={crecheId} petId={id} /> },

            { id: "qr", label: "QR Code", icon: <QrCode className="h-4 w-4" />, content: <QrTab pet={pet} /> },
          ]}
        />
      </div>

      {/* Mobile Accordion */}
      <div className="md:hidden pb-4">
        <Accordion type="single" collapsible defaultValue="overview" className="w-full space-y-3">
          {[
            { id: "overview", label: "Visão Geral", content: <OverviewTab pet={pet} crecheId={crecheId} petId={id} /> },
            { id: "plan", label: "Plano", icon: <UtensilsCrossed className="h-4 w-4" />, content: <PlanTab pet={pet} crecheId={crecheId} petId={id} /> },
            { id: "medical", label: "Saúde", icon: <Syringe className="h-4 w-4" />, content: <MedicalTab crecheId={crecheId} petId={id} /> },

            { id: "qr", label: "QR Code", icon: <QrCode className="h-4 w-4" />, content: <QrTab pet={pet} /> },
          ].map((tab) => (
            <AccordionItem key={tab.id} value={tab.id} className="border border-white/10 bg-black/20 rounded-2xl overflow-hidden shadow-sm">
              <AccordionTrigger className="px-5 py-4 hover:no-underline hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3 text-white text-base">
                  {tab.icon && <div className="text-muted-foreground">{tab.icon}</div>}
                  <span className="font-semibold">{tab.label}</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-5 pt-2">
                {tab.content}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>

      {/* Mobile Sticky Action Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-background/90 backdrop-blur-xl border-t border-white/10 z-50 flex gap-2 overflow-x-auto scrollbar-hide shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        <Button variant="secondary" onClick={() => setQrModalOpen(true)} className="gap-2 flex-1 whitespace-nowrap bg-white/5 border border-white/10 text-white">
          <QrCode className="h-4 w-4" />
          <span>QR Code</span>
        </Button>
        {confirmedBooking && (
          <Button
            variant="outline"
            className="gap-2 flex-1 whitespace-nowrap border-blue-500/30 text-blue-400 bg-blue-500/10"
            onClick={() => setOnTheWayOpen(true)}
          >
            <Navigation className="h-4 w-4" />
            <span>A Caminho</span>
          </Button>
        )}
        <Button variant="secondary" onClick={() => setEditOpen(true)} className="gap-2 flex-1 whitespace-nowrap bg-white/5 border border-white/10 text-white">
          <span>Editar Perfil</span>
        </Button>
        {user?.role !== "tutor" && !pet.isCheckedIn && confirmedBooking && (
          <div className="flex-1 min-w-[120px]"><CheckInButton crecheId={crecheId} bookingId={confirmedBooking.id} /></div>
        )}
      </div>
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
          { crecheId, bookingId } as any,
          {
            onSuccess: () => queryClient.invalidateQueries(),
            onError: (err: any) => {
              const msg = err?.response?.data?.error ?? err?.message ?? "Tente novamente.";
              alert(msg);
            },
          }
        )
      }
      isLoading={checkInMutation.isPending}
      className="shadow-[0_0_20px_rgba(139,92,246,0.4)]"
    >
      <LogIn className="mr-2 h-4 w-4" /> Check-in
    </Button>
  );
}

