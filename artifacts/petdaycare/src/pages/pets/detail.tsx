import React, { useState } from "react";
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
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Dog, Syringe, Activity, Clock, Plus, AlertCircle, LogIn } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";

export default function PetDetail({ id }: { id: number }) {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const queryClient = useQueryClient();

  const { data: pet, isLoading } = useGetPet(crecheId, id);
  const { data: bookings } = useListBookings(crecheId);
  const updatePetMutation = useUpdatePet();

  const [editOpen, setEditOpen] = useState(false);

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

        <div className="flex gap-3 z-10 w-full md:w-auto flex-wrap justify-center md:justify-end">
          <Button variant="glass" onClick={() => setEditOpen(true)}>
            Editar Perfil
          </Button>
          {!pet.isCheckedIn && confirmedBooking && (
            <CheckInButton crecheId={crecheId} bookingId={confirmedBooking.id} />
          )}
        </div>
      </div>

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
          { id: "overview", label: "Visão Geral", content: <OverviewTab pet={pet} /> },
          { id: "medical", label: "Registros Médicos", icon: <Syringe className="h-4 w-4" />, content: <MedicalTab crecheId={crecheId} petId={id} /> },
          { id: "timeline", label: "Linha do Tempo", icon: <Clock className="h-4 w-4" />, content: <TimelineTab crecheId={crecheId} petId={id} /> },
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

function OverviewTab({ pet }: { pet: any }) {
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
          <h3 className="text-lg font-display font-semibold border-b border-white/10 pb-2 mb-5">Alimentação</h3>
          {pet.feedingSchedule ? (
            <div className="space-y-3 text-sm">
              {[["Café da Manhã", pet.feedingSchedule.breakfastTime], ["Almoço", pet.feedingSchedule.lunchTime], ["Jantar", pet.feedingSchedule.dinnerTime]].map(([label, time]) => (
                <div key={label as string} className="flex justify-between items-center py-2 border-b border-white/5">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-medium text-white">{time || "—"}</span>
                </div>
              ))}
              <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/5">
                <p className="text-muted-foreground text-xs mb-1">Ração</p>
                <p className="font-medium text-white">{pet.feedingSchedule.foodType} • {pet.feedingSchedule.portionSize}</p>
              </div>
            </div>
          ) : (
            <EmptyState icon={Dog} title="Sem horário de alimentação" description="Nenhum horário de alimentação configurado." />
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
        },
      },
      {
        onSuccess: () => {
          setVaccineOpen(false);
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
                <div key={v.id} className="p-3 rounded-xl bg-white/5 border border-white/10 flex justify-between items-center">
                  <div>
                    <p className="font-medium text-white">{v.name}</p>
                    <p className="text-xs text-muted-foreground">Aplicada: {format(new Date(v.appliedDate), "dd/MM/yyyy")}</p>
                    {v.veterinarian && <p className="text-xs text-muted-foreground">Dr. {v.veterinarian}</p>}
                  </div>
                  {v.nextDueDate && (
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Próxima</p>
                      <p className="text-sm font-medium text-amber-400">{format(new Date(v.nextDueDate), "dd/MM/yyyy")}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Syringe} title="Sem vacinas" description="Nenhum registro de vacina encontrado." />
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
      <Modal isOpen={vaccineOpen} onClose={() => setVaccineOpen(false)} title="Adicionar Vacina">
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
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setVaccineOpen(false)}>Cancelar</Button>
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

function TimelineTab({ crecheId, petId }: { crecheId: number; petId: number }) {
  const queryClient = useQueryClient();
  const { data: timeline } = useListTimeline(crecheId, petId);
  const addEventMutation = useAddTimelineEvent();
  const [eventOpen, setEventOpen] = useState(false);

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    addEventMutation.mutate(
      {
        crecheId,
        petId,
        data: {
          type: fd.get("type") as any,
          content: (fd.get("content") as string) || null,
          mediaUrl: (fd.get("mediaUrl") as string) || null,
        },
      },
      {
        onSuccess: () => {
          setEventOpen(false);
          queryClient.invalidateQueries();
        },
      }
    );
  };

  return (
    <Card>
      <CardContent className="p-6 max-w-3xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-xl font-display font-semibold">Linha do Tempo</h3>
          <Button onClick={() => setEventOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Adicionar Evento
          </Button>
        </div>

        {timeline?.length ? (
          <div className="relative pl-8 space-y-8 before:absolute before:inset-y-0 before:left-[15px] before:w-px before:bg-white/10">
            {timeline.map((event) => (
              <div key={event.id} className="relative">
                <div className="absolute -left-10 mt-1.5 h-6 w-6 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center shadow-[0_0_10px_rgba(139,92,246,0.3)]">
                  <div className="h-2 w-2 rounded-full bg-primary" />
                </div>
                <div className="glass-panel p-4 rounded-xl">
                  <div className="flex justify-between items-start mb-2">
                    <p className="font-semibold text-white capitalize">{event.type.replace(/_/g, " ")}</p>
                    <span className="text-xs text-muted-foreground">{format(new Date(event.createdAt), "HH:mm")}</span>
                  </div>
                  {event.content && <p className="text-sm text-gray-300">{event.content}</p>}
                  {event.mediaUrl && (
                    <div className="mt-3 rounded-lg overflow-hidden max-h-64 bg-black/50">
                      <img src={event.mediaUrl} alt="Mídia do evento" className="w-full h-full object-contain" />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-white/5">
                    Registrado por {event.authorName}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Clock}
            title="Sem eventos"
            description="Nenhuma atividade registrada para este pet."
            action={{ label: "Adicionar Primeiro Evento", onClick: () => setEventOpen(true) }}
          />
        )}

        <Modal isOpen={eventOpen} onClose={() => setEventOpen(false)} title="Adicionar Evento na Linha do Tempo">
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo de Evento</label>
              <select name="type" required className="flex h-12 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md">
                <option value="note">Nota</option>
                <option value="feeding">Alimentação</option>
                <option value="walk">Passeio</option>
                <option value="play">Brincadeira</option>
                <option value="health">Saúde</option>
                <option value="photo">Foto</option>
                <option value="medication">Medicamento</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descrição</label>
              <textarea
                name="content"
                rows={3}
                placeholder="Descreva o evento..."
                className="flex w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md resize-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">URL da Mídia (opcional)</label>
              <Input name="mediaUrl" placeholder="https://..." />
            </div>
            <div className="pt-4 flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setEventOpen(false)}>Cancelar</Button>
              <Button type="submit" isLoading={addEventMutation.isPending}>Salvar Evento</Button>
            </div>
          </form>
        </Modal>
      </CardContent>
    </Card>
  );
}
