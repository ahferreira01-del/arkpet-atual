import React, { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVaccines,
  useListMedications,
  useAddVaccine,
  useAddMedication,
} from "@workspace/api-client-react";
import { compressImage } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { Syringe, Activity, Plus, Camera, X, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/date-utils";
import { usePetIncidents, useCreateIncident } from "@/hooks/use-medical";

export function MedicalTab({ crecheId, petId }: { crecheId: number; petId: number }) {
  const queryClient = useQueryClient();
  const { data: vaccines } = useListVaccines(crecheId, petId);
  const { data: medications } = useListMedications(crecheId, petId);
  const { data: incidents } = usePetIncidents(crecheId, petId);
  const addVaccineMutation = useAddVaccine();
  const addMedMutation = useAddMedication();
  const addIncidentMutation = useCreateIncident(crecheId);

  const [vaccineOpen, setVaccineOpen] = useState(false);
  const [medOpen, setMedOpen] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [vaccinePhoto, setVaccinePhoto] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const vaccinePhotoRef = useRef<HTMLInputElement>(null);

  const handleVaccinePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("Foto deve ter no máximo 10MB");
      return;
    }
    try {
      const compressed = await compressImage(file, 1200, 0.85);
      setVaccinePhoto(compressed);
    } catch {
      alert("Não foi possível processar a imagem.");
    }
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

  const handleAddIncident = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    addIncidentMutation.mutate(
      {
        petId,
        description: fd.get("description") as string,
        severity: fd.get("severity") as string,
        vetCalled: fd.get("vetCalled") === "true",
        vetName: (fd.get("vetName") as string) || null,
        actionTaken: (fd.get("actionTaken") as string) || null,
      },
      {
        onSuccess: () => {
          setIncidentOpen(false);
          queryClient.invalidateQueries();
        },
      }
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Incidents Row (full width) */}
      <div className="lg:col-span-2">
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
              <h3 className="text-lg font-display font-semibold text-red-400">Incidentes</h3>
              <Button variant="outline" size="sm" onClick={() => setIncidentOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Registrar Incidente
              </Button>
            </div>
            {incidents?.length ? (
              <div className="space-y-3">
                {incidents.map((i: any) => (
                  <div key={i.id} className={`p-4 rounded-xl bg-white/5 border ${i.severity === 'high' ? 'border-red-500/50 bg-red-500/5' : 'border-white/10'}`}>
                    <div className="flex justify-between items-start mb-2">
                      <p className="font-medium text-white">{i.description}</p>
                      <Badge variant={i.severity === 'high' ? 'destructive' : i.severity === 'medium' ? 'outline' : 'secondary'} className={i.severity === 'medium' ? 'text-amber-400 border-amber-500/30' : ''}>
                        {i.severity === 'high' ? 'Grave' : i.severity === 'medium' ? 'Médio' : 'Leve'}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground flex gap-4 mt-2 flex-wrap">
                      <span>Data: {format(new Date(i.incidentDate), "dd/MM/yyyy 'às' HH:mm")}</span>
                      {i.vetCalled && <span className="text-amber-400">Vet. Chamado: Dr(a) {i.vetName || 'Não especificado'}</span>}
                    </div>
                    {i.actionTaken && (
                      <p className="text-sm text-muted-foreground mt-2 border-t border-white/5 pt-2">
                        <strong>Ação:</strong> {i.actionTaken}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={AlertCircle} title="Sem incidentes" description="Nenhum incidente registrado." />
            )}
          </CardContent>
        </Card>
      </div>

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
                          <span className="text-xs text-primary flex items-center gap-0.5">
                            <Camera className="h-3 w-3" /> foto
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Aplicada: {format(parseLocalDate(v.appliedDate), "dd/MM/yyyy")}
                      </p>
                      {v.veterinarian && <p className="text-xs text-muted-foreground">Dr. {v.veterinarian}</p>}
                    </div>
                    {v.nextDueDate && (
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-muted-foreground">Próxima</p>
                        <p className="text-sm font-medium text-amber-400">
                          {format(parseLocalDate(v.nextDueDate), "dd/MM/yyyy")}
                        </p>
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
                    <Badge variant={m.isActive ? "success" : "secondary"}>
                      {m.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{m.dosage} • {m.frequency}</p>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {m.times?.map((t: string) => (
                      <Badge key={t} variant="outline" className="bg-black/40 text-xs">
                        {t}
                      </Badge>
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
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setVaccineOpen(false);
                setVaccinePhoto(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" isLoading={addVaccineMutation.isPending}>
              Salvar Vacina
            </Button>
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
            <Button type="button" variant="ghost" onClick={() => setMedOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={addMedMutation.isPending}>
              Salvar Medicamento
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add Incident Modal */}
      <Modal isOpen={incidentOpen} onClose={() => setIncidentOpen(false)} title="Registrar Incidente">
        <form onSubmit={handleAddIncident} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Descrição *</label>
            <Input name="description" required placeholder="Ex: Vomitou, machucou a pata..." />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Gravidade</label>
            <select name="severity" className="w-full bg-white/5 border border-white/10 rounded-md h-10 px-3 text-sm">
              <option value="low" className="bg-zinc-900">Leve</option>
              <option value="medium" className="bg-zinc-900">Média</option>
              <option value="high" className="bg-zinc-900">Grave</option>
            </select>
          </div>
          <div className="space-y-2 pt-2 border-t border-white/10">
            <label className="text-sm font-medium flex items-center gap-2">
              <input type="checkbox" name="vetCalled" value="true" className="rounded border-white/10 bg-white/5" />
              Veterinário foi chamado?
            </label>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome do Veterinário (se chamado)</label>
            <Input name="vetName" placeholder="Dr. Nome" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Ação Tomada</label>
            <Input name="actionTaken" placeholder="Medicou, limpou ferimento, etc..." />
          </div>
          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={() => setIncidentOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={addIncidentMutation.isPending} className="bg-red-500 hover:bg-red-600 text-white">
              Salvar Incidente
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
