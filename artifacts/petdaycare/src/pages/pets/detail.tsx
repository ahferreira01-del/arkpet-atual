import React, { useState, useRef, useCallback } from "react";
import {
  useGetPet,
  useUpdatePet,
  useListBookings,
  useCheckIn,
  getGetPetQueryKey,
  getListPetsQueryKey,
  getListBookingsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { resolvePhotoUrl, uploadFileDirect, cn } from "@/lib/utils";
import { PetAvatar } from "@/components/pet-avatar";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useTutorInvoices } from "@/hooks/use-financial";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Dog, Syringe, Activity, Clock, AlertCircle, LogIn, Camera, QrCode, UtensilsCrossed, Navigation, Car, MessageSquare, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
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
  const crecheId = user?.crecheId ?? null;
  const queryClient = useQueryClient();

  const { data: pet, isLoading } = useGetPet(crecheId ?? 0, id);
  const { data: bookingsResponse } = useListBookings(crecheId ?? 0);
  const bookings = (bookingsResponse as any)?.items;
  const updatePetMutation = useUpdatePet();
  const { data: tutorInvoicesData } = useTutorInvoices(crecheId ?? 0, pet?.tutorId);
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
    if (!crecheId) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const token = localStorage.getItem("auth_token") ?? "";
      const objectPath = await uploadFileDirect(file, token);
      updatePetMutation.mutate(
        { crecheId, petId: id, data: { photoUrl: objectPath } },
        {
          onSuccess: () => {
            if (crecheId) {
              queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(crecheId, id) });
              queryClient.invalidateQueries({ queryKey: getListPetsQueryKey(crecheId) });
            }
          },
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
      if (!crecheId) throw new Error("Creche não identificada");
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
    if (!crecheId) return;
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
          if (crecheId) {
            queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(crecheId, id) });
            queryClient.invalidateQueries({ queryKey: getListPetsQueryKey(crecheId) });
          }
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
  const canMessageTutor =
    (user?.role === "staff" ||
      user?.role === "creche_admin" ||
      (user?.role === "master_admin" && !!crecheId)) &&
    !!pet.tutorId;

  return (
    <div className="space-y-6 pb-24 md:pb-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => window.history.back()} className="rounded-full hover:bg-secondary min-h-[44px] min-w-[44px]">
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </Button>
        <span className="text-sm text-muted-foreground font-medium">Voltar</span>
      </div>

      {/* Header */}
      <div className="bg-card border border-border rounded-3xl p-6 md:p-8 flex flex-col md:flex-row gap-8 items-center md:items-start relative overflow-hidden">
        <div className="absolute right-0 top-0 w-1/3 h-full bg-gradient-to-l from-primary/5 to-transparent pointer-events-none" />

        {/* Clickable pet avatar for photo upload */}
        <div
          className="h-32 w-32 md:h-40 md:w-40 rounded-full border-4 border-background bg-secondary relative z-10 shadow-md overflow-hidden flex-shrink-0 cursor-pointer group/avatar"
          onClick={() => photoInputRef.current?.click()}
          title="Clique para trocar a foto"
        >
          {uploadingPhoto ? (
            <div className="h-full w-full flex items-center justify-center bg-background/80 backdrop-blur-xs">
              <div className="animate-spin h-8 w-8 rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <PetAvatar
                photoUrl={pet.photoUrl}
                name={pet.name}
                species={pet.species}
                className="h-full w-full object-cover"
                iconClassName="h-16 w-16 text-muted-foreground/30"
              />
          )}
          {!uploadingPhoto && (
            <div className="absolute inset-0 bg-background/70 backdrop-blur-xs flex flex-col items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity">
              <Camera className="h-8 w-8 text-foreground mb-1" />
              <span className="text-xs text-foreground font-medium">Trocar foto</span>
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
            <h1 className="text-4xl font-display font-bold text-foreground tracking-tight">{pet.name}</h1>
            {pet.isCheckedIn ? (
              <Badge variant="success" className="w-max mx-auto md:mx-0">Presente</Badge>
            ) : (
              <Badge variant="secondary" className="w-max mx-auto md:mx-0">Em casa</Badge>
            )}
            {user?.role !== "tutor" && tutorInvoices?.some((inv: any) => inv.status === "overdue") && (
              <Badge variant="destructive" className="w-max mx-auto md:mx-0">Inadimplente</Badge>
            )}
            {user?.role !== "tutor" && tutorInvoices && !tutorInvoices.some((inv: any) => inv.status === "overdue") && (
              <Badge variant="success" className="w-max mx-auto md:mx-0">Adimplente</Badge>
            )}
          </div>
          <p className="text-lg text-muted-foreground capitalize mb-4">
            {pet.breed || speciesMap[pet.species] || pet.species} • {genderMap[pet.gender] || pet.gender} • {pet.weight ? `${pet.weight} kg` : "Peso desconhecido"}
          </p>
          <div className="flex flex-wrap gap-2 justify-center md:justify-start mb-2">
            {pet.weight && (
              <Badge variant="secondary">
                Porte {pet.weight < 10 ? "Pequeno" : pet.weight < 25 ? "Médio" : "Grande"}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2 justify-center md:justify-start">
            {pet.temperament && (
              <Badge variant="outline" className="capitalize">
                <Activity className="w-3 h-3 mr-1" /> {temperamentMap[pet.temperament] || pet.temperament}
              </Badge>
            )}
            {pet.allergies && (
              <Badge variant="destructive">
                <AlertCircle className="w-3 h-3 mr-1" /> Alergias
              </Badge>
            )}
            {pet.specialNeeds && (
              <Badge variant="warning">
                <AlertCircle className="w-3 h-3 mr-1" /> Necessidades especiais
              </Badge>
            )}
            <Badge variant="outline" className={(pet as any).isCastrated ? "bg-success/10 text-success border-success/30" : "bg-muted text-muted-foreground"}>
              {(pet as any).isCastrated ? "✓ Castrado" : "Não castrado"}
            </Badge>
          </div>
        </div>

        <div className="hidden md:flex gap-2 z-10 w-auto flex-wrap justify-end ml-auto">
          {canMessageTutor && (
            <Link
              href={`/chat?tutor=${pet.tutorId}`}
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "gap-2 min-h-10")}
            >
              <MessageSquare className="h-4 w-4" />
              <span>Mensagem</span>
            </Link>
          )}
          <Button variant="secondary" size="sm" onClick={() => setQrModalOpen(true)} className="gap-2 min-h-10">
            <QrCode className="h-4 w-4" />
            <span>QR Code</span>
          </Button>
          {confirmedBooking && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 min-h-10 text-primary border-primary/30 hover:bg-primary/10"
              onClick={() => setOnTheWayOpen(true)}
            >
              <Navigation className="h-4 w-4" />
              <span>A Caminho</span>
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)} className="gap-2 min-h-10">
            <span>Editar Perfil</span>
          </Button>
          {user?.role !== "tutor" && !pet.isCheckedIn && confirmedBooking && (
            <CheckInButton crecheId={crecheId ?? 0} bookingId={confirmedBooking.id} petId={id} />
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
              className="w-full min-h-10"
            >
              <Car className="mr-2 h-4 w-4" /> {user?.role === "tutor" ? "Levar o pet" : "Entregar o pet"}
            </Button>
            <Button
              onClick={() => confirmedBooking && onTheWayMutation.mutate({ bookingId: confirmedBooking.id, type: "pickup", etaMinutes: Number(eta) })}
              isLoading={onTheWayMutation.isPending}
              variant="outline"
              className="w-full min-h-10"
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

      {/* Edit Profile Modal */}
      <Modal isOpen={editOpen} onClose={() => setEditOpen(false)} title={`Editar ${pet.name}`} description="Atualize as informações do pet">
        <form onSubmit={handleEditProfile} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Nome</label>
            <Input name="name" defaultValue={pet.name} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Raça</label>
              <Input name="breed" defaultValue={pet.breed || ""} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Data de Nascimento</label>
              <Input type="date" name="birthDate" defaultValue={pet.birthDate || ""} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Peso (kg)</label>
              <Input type="number" step="0.1" name="weight" defaultValue={pet.weight || ""} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Cor</label>
              <Input name="color" defaultValue={pet.color || ""} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Temperamento</label>
            <select name="temperament" defaultValue={pet.temperament || ""} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="">Selecione...</option>
              <option value="calm">Calmo</option>
              <option value="playful">Brincalhão</option>
              <option value="aggressive">Agressivo</option>
              <option value="shy">Tímido</option>
              <option value="sociable">Sociável</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Alergias</label>
            <Input name="allergies" defaultValue={pet.allergies || ""} placeholder="Ex: Frango, pólen..." />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Necessidades Especiais</label>
            <Input name="specialNeeds" defaultValue={pet.specialNeeds || ""} placeholder="Ex: Medo de trovão, não gosta de outros cães..." />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input type="checkbox" id="isCastrated" name="isCastrated" defaultChecked={!!(pet as any).isCastrated} className="rounded border-input text-primary" />
            <label htmlFor="isCastrated" className="text-sm font-medium text-foreground cursor-pointer">Castrado</label>
          </div>

          <div className="modal-sticky-footer flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button type="submit" isLoading={updatePetMutation.isPending}>Salvar</Button>
          </div>
        </form>
      </Modal>

      {/* Desktop Tabs */}
      <div className="hidden md:block">
        <Tabs
          defaultTab="overview"
          tabs={[
            { id: "overview", label: "Visão Geral", content: <OverviewTab pet={pet} crecheId={crecheId ?? 0} petId={id} /> },
            { id: "plan", label: "Plano", icon: <UtensilsCrossed className="h-4 w-4" />, content: <PlanTab pet={pet} crecheId={crecheId ?? 0} petId={id} /> },
            { id: "medical", label: "Saúde", icon: <Syringe className="h-4 w-4" />, content: <MedicalTab crecheId={crecheId ?? 0} petId={id} /> },

            { id: "qr", label: "QR Code", icon: <QrCode className="h-4 w-4" />, content: <QrTab pet={pet} /> },
          ]}
        />
      </div>

      {/* Mobile Accordion */}
      <div className="md:hidden pb-4">
        <Accordion type="single" collapsible defaultValue="overview" className="w-full space-y-3">
          {[
            { id: "overview", label: "Visão Geral", content: <OverviewTab pet={pet} crecheId={crecheId ?? 0} petId={id} /> },
            { id: "plan", label: "Plano", icon: <UtensilsCrossed className="h-4 w-4" />, content: <PlanTab pet={pet} crecheId={crecheId ?? 0} petId={id} /> },
            { id: "medical", label: "Saúde", icon: <Syringe className="h-4 w-4" />, content: <MedicalTab crecheId={crecheId ?? 0} petId={id} /> },

            { id: "qr", label: "QR Code", icon: <QrCode className="h-4 w-4" />, content: <QrTab pet={pet} /> },
          ].map((tab) => (
            <AccordionItem key={tab.id} value={tab.id} className="border border-border bg-card rounded-2xl overflow-hidden shadow-sm">
              <AccordionTrigger className="px-5 py-4 hover:no-underline hover:bg-secondary/50 transition-colors min-h-[44px]">
                <div className="flex items-center gap-3 text-foreground text-base">
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
      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 pb-nav-safe bg-background/90 backdrop-blur-xl border-t border-border z-50 flex gap-2 overflow-x-auto scrollbar-hide shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        {canMessageTutor && (
          <Link
            href={`/chat?tutor=${pet.tutorId}`}
            className={cn(buttonVariants({ variant: "secondary" }), "gap-2 flex-1 whitespace-nowrap min-h-[44px]")}
          >
            <MessageSquare className="h-4 w-4" />
            <span>Mensagem</span>
          </Link>
        )}
        <Button variant="secondary" onClick={() => setQrModalOpen(true)} className="gap-2 flex-1 whitespace-nowrap min-h-[44px]">
          <QrCode className="h-4 w-4" />
          <span>QR Code</span>
        </Button>
        {confirmedBooking && (
          <Button
            variant="outline"
            className="gap-2 flex-1 whitespace-nowrap text-primary border-primary/30 min-h-[44px]"
            onClick={() => setOnTheWayOpen(true)}
          >
            <Navigation className="h-4 w-4" />
            <span>A Caminho</span>
          </Button>
        )}
        <Button variant="secondary" onClick={() => setEditOpen(true)} className="gap-2 flex-1 whitespace-nowrap min-h-[44px]">
          <span>Editar Perfil</span>
        </Button>
        {user?.role !== "tutor" && !pet.isCheckedIn && confirmedBooking && (
          <div className="flex-1 min-w-[120px]"><CheckInButton crecheId={crecheId ?? 0} bookingId={confirmedBooking.id} petId={id} /></div>
        )}
      </div>
    </div>
  );
}

function CheckInButton({ crecheId, bookingId, petId }: { crecheId: number; bookingId: number; petId: number }) {
  const checkInMutation = useCheckIn();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return (
    <Button
      onClick={() =>
        checkInMutation.mutate(
          { crecheId, bookingId } as any,
          {
            onSuccess: () => {
              if (crecheId) {
                queryClient.invalidateQueries({ queryKey: getGetPetQueryKey(crecheId, petId) });
                queryClient.invalidateQueries({ queryKey: getListBookingsQueryKey(crecheId) });
                queryClient.invalidateQueries({ queryKey: getListPetsQueryKey(crecheId) });
              }
              toast({ title: "Check-in realizado com sucesso!" });
            },
            onError: (err: any) => {
              const msg = err?.response?.data?.error ?? err?.message ?? "Tente novamente.";
              toast({ title: "Erro no check-in", description: msg, variant: "destructive" });
            },
          }
        )
      }
      isLoading={checkInMutation.isPending}
      className="shadow-sm min-h-10"
    >
      <LogIn className="mr-2 h-4 w-4" /> Check-in
    </Button>
  );
}

