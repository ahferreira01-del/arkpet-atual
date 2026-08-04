import React, { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useListPets, useCreateBooking } from "@workspace/api-client-react";
import { useListCatalogue, usePackagesBalance, useServiceCredits } from "@/hooks/use-financial";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CheckCircle2,
  ChevronRight,
  ArrowLeft,
  Calendar as CalendarIcon,
  Clock,
  Bone,
  Info,
  Check,
  AlertCircle,
} from "lucide-react";

// Strips size qualifiers (pequeno/médio/grande) so "Banho Pequeno" and
// "Banho Grande" both resolve to "banho" for credit-matching purposes.
const SIZE_WORDS = new Set([
  'pequeno','pequena','medio','media','mediano','mediana',
  'grande','small','medium','large','mini','maxi','plus','p','m','g','gg','xg',
]);
function normalizeServiceType(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0 && !SIZE_WORDS.has(w))
    .join('_');
  return slug || 'servico';
}

const STEPS = [
  { id: 1, title: "Escolher Pets" },
  { id: 2, title: "Serviço" },
  { id: 3, title: "Agendamento" },
  { id: 4, title: "Confirmação" },
];

export default function NewBooking() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const isTutor = user?.role === "tutor";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: petsResponse } = useListPets(crecheId);
  const pets = (petsResponse as any)?.items;
  const { data: catalogue, isLoading: catalogueLoading } =
    useListCatalogue(crecheId);
  const { data: packagesData } = usePackagesBalance(crecheId);
  const { data: serviceCreditsData } = useServiceCredits(crecheId);
  const createMutation = useCreateBooking();

  const [step, setStep] = useState(1);
  const [selectedPetIds, setSelectedPetIds] = useState<number[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(
    null,
  );

  const [form, setForm] = useState({
    startDate: format(new Date(), "yyyy-MM-dd"),
    endDate: "",
    notes: "",
  });

  const availablePets = isTutor
    ? pets?.filter((p) => p.tutorId === user?.id)
    : pets;
  // Include both "service" and "day_use" catalogue items in the selector.
  // "day_use" is a canonical catalogue type distinct from generic services.
  const rawServices = catalogue?.filter((item: any) =>
    item.type === "service" || item.type === "day_use"
  ) || [];
  const services = [...rawServices];
  
  if (packagesData?.packages && packagesData.packages.length > 0) {
    const packagesByLimit = packagesData.packages.reduce((acc: any, pkg: any) => {
      const limit = pkg.maxPetsPerDay || 1;
      if (!acc[limit]) acc[limit] = 0;
      acc[limit] += (pkg.totalCredits - pkg.usedCredits);
      return acc;
    }, {});

    Object.entries(packagesByLimit).forEach(([limitStr, disp]) => {
      const limit = Number(limitStr);
      services.unshift({
        id: -limit,
        name: `Usar Diárias (${disp} disp.)`,
        type: "package",
        price: 0,
        maxPets: limit,
      });
    });
  }

  const selectedService = services.find((s: any) => s.id === selectedServiceId);

  const handleNext = () => {
    if (step === 1 && selectedPetIds.length === 0) {
      toast({
        title: "Atenção",
        description: "Selecione pelo menos um pet.",
        variant: "destructive",
      });
      return;
    }
    if (step === 2 && !selectedServiceId) {
      toast({
        title: "Atenção",
        description: "Selecione um serviço ou pacote.",
        variant: "destructive",
      });
      return;
    }
    if (step === 3 && !form.startDate) {
      toast({
        title: "Atenção",
        description: "A data de início é obrigatória.",
        variant: "destructive",
      });
      return;
    }
    setStep((s) => Math.min(s + 1, 4));
  };

  const handlePrev = () => {
    setStep((s) => Math.max(s - 1, 1));
  };

  const getPetPrice = (petId: number) => {
    if (!selectedService) return { price: 0, usedSize: false, pet: undefined };
    const pet = availablePets?.find((p) => p.id === petId);
    let price = selectedService.price;
    let usedSize = false;

    if (selectedService.pricingBySize && pet?.size) {
      if (pet.size === "small" && selectedService.pricingBySize.small) {
        price = selectedService.pricingBySize.small;
        usedSize = true;
      } else if (
        pet.size === "medium" &&
        selectedService.pricingBySize.medium
      ) {
        price = selectedService.pricingBySize.medium;
        usedSize = true;
      } else if (
        pet.size === "large" &&
        selectedService.pricingBySize.large
      ) {
        price = selectedService.pricingBySize.large;
        usedSize = true;
      }
    }
    return { price, usedSize, pet };
  };

  const handleConfirm = async () => {
    if (!selectedService) return;

    // Use the catalogue item's canonical type directly when it is a known
    // non-"service" type (e.g. "day_use"). For generic "service" catalogue
    // items, derive a stable slug from the name so the confirmation step can
    // look up the item by name-slug matching (i.name.toLowerCase().replace(/\s+/g, "_")).
    const typePayload = selectedService.type !== "service"
      ? selectedService.type
      : selectedService.name
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, "_")
          .replace(/[^a-z0-9_]/g, "")
        || "servico";
    try {
      await Promise.all(
        selectedPetIds.map((petId) => {
          const { price } = getPetPrice(petId);
          return createMutation.mutateAsync({
            crecheId,
            data: {
              petId,
              type: typePayload, // Envia o nome como tipo
              startDate: form.startDate,
              endDate: form.endDate || undefined,
              notes: form.notes || undefined,
              price,
              packageMaxPets: selectedService.id < 0 ? selectedService.maxPets : undefined,
            } as any,
          });
        }),
      );

      queryClient.invalidateQueries();
      toast({
        title: "Reserva Efetuada",
        description:
          selectedPetIds.length > 1
            ? `Criadas ${selectedPetIds.length} reservas com sucesso.`
            : "Reserva criada com sucesso.",
      });
      setLocation("/bookings");
    } catch (err: any) {
      // Se o servidor retornou HTML (ex: proxy 404 durante reinício),
      // mostramos uma mensagem amigável em vez do HTML bruto.
      const raw: string = err?.message ?? "";
      const isHtmlError =
        raw.includes("<!DOCTYPE") || raw.includes("<html") || raw.includes("text/html");
      toast({
        title: "Erro ao criar reserva",
        description: isHtmlError
          ? "Não foi possível conectar ao servidor. Aguarde alguns segundos e tente novamente."
          : raw || "Ocorreu um erro inesperado.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="border-b border-white/5 bg-background">
        <div className="max-w-4xl mx-auto px-4 md:px-8 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/bookings")}
            className="rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-display font-semibold text-white">
              Nova Reserva
            </h1>
            <p className="text-sm text-muted-foreground">
              Agendamento de serviço ou estadia
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 pb-32">
        {/* Stepper Progress */}
        <div className="flex items-center justify-between mb-8 relative">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-full h-1 bg-white/5 rounded-full -z-10" />
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 bg-primary rounded-full -z-10 transition-all duration-500 ease-in-out"
            style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }}
          />

          {STEPS.map((s) => {
            const isCompleted = step > s.id;
            const isCurrent = step === s.id;
            return (
              <div
                key={s.id}
                className="flex flex-col items-center gap-2 bg-background px-2"
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 shadow-xl ${
                    isCompleted
                      ? "bg-primary text-primary-foreground scale-95"
                      : isCurrent
                        ? "bg-primary text-primary-foreground scale-110 ring-4 ring-primary/20"
                        : "bg-white/5 border border-white/10 text-muted-foreground"
                  }`}
                >
                  {isCompleted ? <Check className="w-5 h-5" /> : s.id}
                </div>
                <span
                  className={`text-xs font-medium hidden sm:block ${isCurrent || isCompleted ? "text-white" : "text-muted-foreground"}`}
                >
                  {s.title}
                </span>
              </div>
            );
          })}
        </div>

        {/* Step 1: Pets */}
        {step === 1 && (
          <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-white font-display">
                Quais pets farão a reserva?
              </h2>
              <p className="text-muted-foreground">
                Você pode selecionar um ou mais pets simultaneamente.
              </p>
            </div>

            {!availablePets?.length ? (
              <div className="text-center p-8 bg-white/5 border border-white/10 rounded-2xl">
                <Bone className="w-12 h-12 text-white/20 mx-auto mb-4" />
                <h3 className="text-white font-medium mb-1">
                  Nenhum pet encontrado
                </h3>
                <p className="text-sm text-muted-foreground">
                  Cadastre um pet primeiro para fazer a reserva.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {availablePets?.map((pet) => {
                  const isSelected = selectedPetIds.includes(pet.id);
                  return (
                    <Card
                      key={pet.id}
                      className={`cursor-pointer transition-all duration-300 overflow-hidden ${isSelected ? "ring-2 ring-primary border-primary bg-primary/5" : "hover:border-white/20"}`}
                      onClick={() =>
                        setSelectedPetIds((prev) =>
                          isSelected
                            ? prev.filter((id) => id !== pet.id)
                            : [...prev, pet.id],
                        )
                      }
                    >
                      <CardContent className="p-4 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {pet.photoUrl ? (
                            <img
                              src={pet.photoUrl}
                              alt={pet.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <Bone className="w-6 h-6 text-white/30" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-white truncate">
                            {pet.name}
                          </h4>
                          <p className="text-xs text-muted-foreground truncate">
                            {pet.breed || pet.species || "Raça não informada"} •{" "}
                            {pet.size === "small"
                              ? "Pequeno"
                              : pet.size === "medium"
                                ? "Médio"
                                : pet.size === "large"
                                  ? "Grande"
                                  : "Porte Indefinido"}
                          </p>
                        </div>
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors ${isSelected ? "bg-primary border-primary text-white" : "border-white/20 text-transparent"}`}
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Service */}
        {step === 2 && (
          <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-white font-display">
                Qual serviço você deseja?
              </h2>
              <p className="text-muted-foreground">
                Escolha no catálogo a opção que melhor atende à sua necessidade
                hoje.
              </p>
            </div>

            {catalogueLoading ? (
              <div className="text-center p-8 text-muted-foreground">
                Carregando catálogo...
              </div>
            ) : services.length === 0 ? (
              <div className="text-center p-8 bg-white/5 border border-white/10 rounded-2xl">
                <h3 className="text-white font-medium mb-1">Catálogo vazio</h3>
                <p className="text-sm text-muted-foreground">
                  Nenhum serviço ou pacote disponível no momento.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(() => {
                  const maxAvailableLimit = Math.max(0, ...services.filter((s: any) => s.id < 0).map((s: any) => s.maxPets || 1));
                  return services.map((service: any) => {
                    const isSelected = selectedServiceId === service.id;
                    const isPackage = service.type === "package";
                    const isSuboptimalPackage = service.id < 0 && service.maxPets < Math.min(selectedPetIds.length, maxAvailableLimit);

                    return (
                      <Card
                        key={service.id}
                        className={`transition-all duration-300 ${isSuboptimalPackage ? "opacity-50 grayscale cursor-not-allowed" : "cursor-pointer hover:border-white/20"} ${isSelected && !isSuboptimalPackage ? "ring-2 ring-primary border-primary bg-primary/5" : ""}`}
                        onClick={() => {
                          if (!isSuboptimalPackage) setSelectedServiceId(service.id);
                        }}
                      >
                        <CardContent className="p-5">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-3">
                            <div
                              className={`p-2 rounded-xl ${isPackage ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"}`}
                            >
                              {isPackage ? (
                                <CalendarIcon className="w-5 h-5" />
                              ) : (
                                <Clock className="w-5 h-5" />
                              )}
                            </div>
                            <div>
                              <h4 className="font-semibold text-white">
                                {service.name}
                              </h4>
                              <span className="text-[10px] uppercase font-bold text-muted-foreground">
                                {isPackage ? "Pacote" : "Serviço"}
                              </span>
                            </div>
                          </div>
                          <div
                            className={`w-5 h-5 rounded-full flex items-center justify-center border transition-colors ${isSelected ? "bg-primary border-primary text-white" : "border-white/20 text-transparent"}`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                          </div>
                        </div>

                        <div className="mt-4">
                          {service.id < 0 ? (
                            <div>
                              <p className="text-sm text-emerald-400 font-medium">Será descontado das suas diárias</p>
                              <p className="text-[10px] text-emerald-400/70 mt-1 uppercase tracking-wide font-bold">
                                {service.maxPets > 1 ? `PACOTE MULTI-PET: ATÉ ${service.maxPets} PETS POR DIÁRIA` : `PACOTE INDIVIDUAL: 1 PET POR DIÁRIA`}
                              </p>
                              {isSuboptimalPackage && (
                                <p className="text-xs text-orange-400 mt-2 font-medium">
                                  Bloqueado: Você tem um pacote mais vantajoso para {selectedPetIds.length} pet(s).
                                </p>
                              )}
                            </div>
                          ) : (
                            <div>
                              <p className="text-2xl font-bold text-emerald-400">
                                {(service.price / 100).toLocaleString("pt-BR", {
                                  style: "currency",
                                  currency: "BRL",
                                })}
                                {service.pricingBySize && (
                                  <span className="text-xs text-muted-foreground font-normal ml-2 tracking-wide">
                                    *Variável por porte
                                  </span>
                                )}
                              </p>
                              {(() => {
                                // Match credits by normalized base service type so that a
                                // "Banho Pequeno" credit shows on "Banho Grande" cards too.
                                const baseType = normalizeServiceType(service.name);
                                const matchingCredits = serviceCreditsData?.data?.filter(
                                  (c: any) =>
                                    normalizeServiceType(c.itemName) === baseType &&
                                    c.usedCredits < c.totalCredits
                                ) ?? [];
                                const remaining = matchingCredits.reduce(
                                  (sum: number, c: any) => sum + (c.totalCredits - c.usedCredits),
                                  0,
                                );
                                if (remaining > 0) {
                                  return (
                                    <div className="mt-2 inline-flex items-center rounded-md bg-purple-500/10 px-2 py-1 text-xs font-medium text-purple-400 ring-1 ring-inset ring-purple-500/30">
                                      {remaining} {remaining === 1 ? 'Pré-pago disponível' : 'Pré-pagos disponíveis'}
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                  });
                })()}
              </div>
            )}

            {selectedServiceId !== null && selectedServiceId < 0 && selectedService?.maxPets > 1 && (
              <div className="mt-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex gap-3 animate-in fade-in slide-in-from-bottom-2">
                <Info className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold mb-1">Pacote Multi-Pet ({selectedService.maxPets} pets/diária)</p>
                  {selectedPetIds.length > selectedService.maxPets ? (
                    <p className="text-orange-400">Você selecionou {selectedPetIds.length} pets, mas este pacote cobre apenas {selectedService.maxPets} pet(s) por diária. As diárias excedentes serão cobradas do seu saldo ou faturadas separadamente.</p>
                  ) : selectedPetIds.length < selectedService.maxPets ? (
                    <p>Você selecionou {selectedPetIds.length} pet(s). Como este pacote cobre até {selectedService.maxPets} pets, você poderia adicionar mais {selectedService.maxPets - selectedPetIds.length} pet(s) para aproveitar a mesma diária sem custo adicional.</p>
                  ) : (
                    <p>Você selecionou a quantidade exata de pets ({selectedService.maxPets}) coberta pelo seu pacote. Excelente aproveitamento!</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Dates */}
        {step === 3 && (
          <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-white font-display">
                Para quando?
              </h2>
              <p className="text-muted-foreground">
                Defina a data e adicione orientações especiais, se houver.
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white flex items-center gap-2">
                    Data de Entrada <span className="text-red-400">*</span>
                  </label>
                  <Input
                    type="date"
                    className="h-12 bg-black/40 border-white/10 text-white [color-scheme:dark]"
                    value={form.startDate}
                    min={format(new Date(), "yyyy-MM-dd")}
                    onChange={(e) =>
                      setForm({ ...form, startDate: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white flex items-center gap-2">
                    Data de Saída{" "}
                    <span className="text-muted-foreground font-normal text-xs">
                      (Opcional)
                    </span>
                  </label>
                  <Input
                    type="date"
                    className="h-12 bg-black/40 border-white/10 text-white [color-scheme:dark]"
                    value={form.endDate}
                    onChange={(e) =>
                      setForm({ ...form, endDate: e.target.value })
                    }
                    min={form.startDate}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  Observações Especiais
                </label>
                <textarea
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm min-h-[100px] text-white focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground"
                  placeholder="Ex: Precisa de medicação às 14h, tem alergia a frango..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Summary */}
        {step === 4 && (
          <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold text-white font-display">
                Revisão Final
              </h2>
              <p className="text-muted-foreground">
                Confira os detalhes e os valores estimados antes de concluir.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Context Column */}
              <div className="space-y-4">
                <Card className="bg-white/5 border-white/10">
                  <CardContent className="p-5 space-y-4">
                    <div>
                      <span className="text-xs text-muted-foreground block mb-1">
                        Serviço Selecionado
                      </span>
                      <h4 className="font-semibold text-lg text-white">
                        {selectedService?.name}
                      </h4>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-xs text-muted-foreground block mb-1">
                          Data de Entrada
                        </span>
                        <p className="text-white font-medium">
                          {form.startDate
                            ? format(
                                new Date(form.startDate + "T12:00:00"),
                                "dd/MM/yyyy",
                              )
                            : "--"}
                        </p>
                      </div>
                      {form.endDate && (
                        <div>
                          <span className="text-xs text-muted-foreground block mb-1">
                            Data de Saída
                          </span>
                          <p className="text-white font-medium">
                            {format(
                              new Date(form.endDate + "T12:00:00"),
                              "dd/MM/yyyy",
                            )}
                          </p>
                        </div>
                      )}
                    </div>

                    {form.notes && (
                      <div>
                        <span className="text-xs text-muted-foreground block mb-1">
                          Observações
                        </span>
                        <p className="text-white text-sm bg-black/20 p-3 rounded-lg border border-white/5">
                          {form.notes}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {isTutor && (
                  <div className="flex gap-3 items-start p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
                    <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <p className="text-sm">
                      Sua reserva será enviada com o status{" "}
                      <strong>Pendente</strong>. Nossa equipe irá verificar a
                      disponibilidade e aprovar o agendamento em breve.
                    </p>
                  </div>
                )}
              </div>

              {/* Financial Column */}
              <div className="space-y-4">
                {(() => {
                  const start = form.startDate ? new Date(form.startDate + "T12:00:00") : null;
                  const end = form.endDate ? new Date(form.endDate + "T12:00:00") : start;
                  let durationDays = 1;
                  if (start && end) {
                    // Count nights, not endpoints: today→tomorrow = 1 night (no +1).
                    durationDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)));
                  }
                  
                  const totalDaysRequested = durationDays * selectedPetIds.length;
                  const isPackage = selectedService?.type === "package";
                  let excessDays = 0;
                  
                  if (isPackage && packagesData) {
                    excessDays = Math.max(0, totalDaysRequested - packagesData.availableCredits);
                  }
                  
                  const fallbackDayUseService = catalogue?.find((s: any) => {
                    if (s.type !== "service" && s.type !== "day_use") return false;
                    const name = s.name.toLowerCase();
                    return name.includes("creche") || name.includes("day") || name.includes("diária");
                  });

                  let totalCost = 0;
                  let originalCost = 0;
                  let discountCost = 0;
                  let availableServiceCredits = 0;
                  let creditsToUse = 0;

                  // Track how many day-slots of each pet are covered by service credits
                  const creditsByPet = new Map<number, number>();

                  if (!isPackage && selectedService) {
                     // Build cost entries preserving petId so credits can be attributed per-pet
                     const costEntries: Array<{ petId: number; cost: number }> = [];
                     for (let i = 0; i < durationDays; i++) {
                       for (const petId of selectedPetIds) {
                         costEntries.push({ petId, cost: getPetPrice(petId).price });
                       }
                     }
                     originalCost = costEntries.reduce((acc, e) => acc + e.cost, 0);

                     // Match credits by normalized service type (same logic as server):
                     // "Banho Pequeno" credits cover "Banho Grande" bookings, etc.
                     // Aggregate ALL matching records (not just first) in FIFO order (asc id).
                     const bookingServiceType = normalizeServiceType(selectedService.name);
                     const matchingServiceCredits = ((serviceCreditsData?.data ?? []) as any[])
                       .filter((c: any) => normalizeServiceType(c.itemName) === bookingServiceType)
                       .sort((a: any, b: any) => a.id - b.id); // FIFO: server consumes in asc(id) order

                     availableServiceCredits = matchingServiceCredits.reduce(
                       (acc: number, c: any) => acc + (c.totalCredits - c.usedCredits), 0
                     );

                     // Server processes each pet booking independently and sequentially,
                     // consuming up to durationDays credits per pet in order.
                     // Replicate the same FIFO allocation here for an accurate preview.
                     let creditPool = availableServiceCredits;
                     for (const petId of selectedPetIds) {
                       const creditsForThisPet = Math.min(durationDays, creditPool);
                       if (creditsForThisPet > 0) creditsByPet.set(petId, creditsForThisPet);
                       creditPool -= creditsForThisPet;
                       if (creditPool <= 0) break;
                     }

                     creditsToUse = availableServiceCredits - creditPool;

                     // discountCost = sum of prices for each credited pet-day slot
                     for (const [petId, creditedDays] of creditsByPet) {
                       const { price } = getPetPrice(petId);
                       discountCost += price * creditedDays;
                     }

                     totalCost = originalCost - discountCost;
                  } else if (isPackage && excessDays > 0) {
                     // Estimativa simplificada baseada no preço base da diária avulsa, se existir
                     totalCost = excessDays * (fallbackDayUseService?.basePrice || 0);
                  }

                  return (
                    <>
                      {isPackage && excessDays > 0 && (
                        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-yellow-500 text-sm flex gap-3">
                          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                          <p>
                            Você possui <strong>{packagesData?.availableCredits || 0} diárias</strong>, mas esta reserva consumirá <strong>{totalDaysRequested} diárias</strong> no total (calculado por pet). 
                            {fallbackDayUseService ? (
                              <span> Será gerada uma fatura referente a <strong>{excessDays} diária(s) excedente(s)</strong> no valor aproximado de <strong>{(totalCost / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>.</span>
                            ) : (
                              <span> <strong>Atenção:</strong> O serviço de diária não foi encontrado no catálogo da creche. Este agendamento poderá ser bloqueado ou não faturado.</span>
                            )}
                          </p>
                        </div>
                      )}
                      
                      <Card className="bg-gradient-to-br from-white/5 to-transparent border-white/10">
                        <CardContent className="p-5">
                          <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                            <span className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                              <span className="text-lg">💰</span>
                            </span>
                            Resumo Financeiro
                          </h3>

                          <div className="space-y-3 mb-6">
                            {selectedPetIds.map((petId) => {
                              const { price, usedSize, pet } = getPetPrice(petId);
                              const petCreditsUsed = isPackage ? 0 : (creditsByPet.get(petId) || 0);
                              const petCreditedDays = Math.min(durationDays, petCreditsUsed);
                              const petPaidDays = durationDays - petCreditedDays;
                              const petCost = isPackage ? 0 : price * petPaidDays;
                              const fullyByCredit = !isPackage && petCreditedDays === durationDays;
                              const partiallyByCredit = !isPackage && petCreditedDays > 0 && petPaidDays > 0;
                              return (
                                <div
                                  key={petId}
                                  className={`flex justify-between items-center p-3 rounded-xl border ${fullyByCredit ? "bg-purple-500/10 border-purple-500/20" : partiallyByCredit ? "bg-purple-500/5 border-purple-500/10" : "bg-black/20 border-white/5"}`}
                                >
                                  <div>
                                    <p className="text-sm font-medium text-white flex items-center gap-2">
                                      {pet?.name}
                                      {fullyByCredit && (
                                        <span className="text-[10px] font-semibold bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                                          Crédito
                                        </span>
                                      )}
                                      {partiallyByCredit && (
                                        <span className="text-[10px] font-semibold bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                                          {petCreditedDays}d crédito
                                        </span>
                                      )}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                      {isPackage ? "Consumo de Diária" : (usedSize ? "Calculado por porte" : "Valor Base")} {durationDays > 1 && !isPackage && `(x${durationDays} dias)`}
                                    </p>
                                  </div>
                                  <span className={`font-semibold ${fullyByCredit ? "text-purple-300" : "text-white"}`}>
                                    {isPackage ? "--" : fullyByCredit
                                      ? (0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                                      : (petCost / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                                    }
                                  </span>
                                </div>
                              );
                            })}
                            
                            {!isPackage && discountCost > 0 && (
                                <div className="flex justify-between items-center p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 mt-2">
                                  <div>
                                    <p className="text-sm font-medium text-purple-400 flex items-center gap-1.5">
                                      🎟️ Crédito pré-pago aplicado
                                    </p>
                                    <p className="text-[10px] text-purple-400/80 uppercase tracking-wide mt-0.5">
                                      {creditsToUse} {creditsToUse === 1 ? `crédito de ${selectedService?.name}` : `créditos de ${selectedService?.name}`}
                                    </p>
                                  </div>
                                  <span className="font-semibold text-purple-400">
                                    - {(discountCost / 100).toLocaleString("pt-BR", {
                                      style: "currency",
                                      currency: "BRL",
                                    })}
                                  </span>
                                </div>
                            )}
                          </div>

                          <div className="pt-4 border-t border-white/10 flex justify-between items-end">
                            <span className="text-muted-foreground font-medium">
                              {isPackage && excessDays > 0 ? "Fatura (Excedente Estimado)" : "Total Estimado"}
                            </span>
                            <span className="text-3xl font-bold text-emerald-400">
                              {(totalCost / 100).toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Action Footer */}
      <div className="fixed bottom-0 left-0 w-full bg-[#11111a]/90 backdrop-blur-xl border-t border-white/10 p-4 md:p-6 z-20 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={step === 1 ? () => setLocation("/bookings") : handlePrev}
            className="text-muted-foreground hover:text-white"
          >
            {step === 1 ? "Cancelar" : "Voltar"}
          </Button>

          {step < 4 ? (
            <Button
              size="lg"
              className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[120px]"
              onClick={handleNext}
            >
              Próximo <ChevronRight className="ml-2 w-4 h-4" />
            </Button>
          ) : (
            <Button
              size="lg"
              className="bg-emerald-500 hover:bg-emerald-600 text-white min-w-[150px] shadow-lg shadow-emerald-500/20"
              onClick={handleConfirm}
              isLoading={createMutation.isPending}
            >
              Confirmar Reserva
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
