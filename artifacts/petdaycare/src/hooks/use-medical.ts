import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function usePetVaccines(crecheId: number, petId: number) {
  return useQuery({
    queryKey: ["vaccines", crecheId, petId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/medical/vaccines/${petId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar vacinas");
      return res.json();
    }
  });
}

export function useCreateVaccine(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/medical/vaccines`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error("Erro ao registrar vacina");
      return res.json();
    },
    onSuccess: (_, { petId }) => {
      queryClient.invalidateQueries({ queryKey: ["vaccines", crecheId, petId] });
    }
  });
}

export function useUploadVaccineReceipt(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ vaccineId, receiptUrl, petId }: { vaccineId: number, receiptUrl: string, petId: number }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/medical/vaccines/${vaccineId}/receipt`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ receiptUrl })
      });
      if (!res.ok) throw new Error("Erro ao enviar comprovante");
      return res.json();
    },
    onSuccess: (_, { petId }) => {
      queryClient.invalidateQueries({ queryKey: ["vaccines", crecheId, petId] });
    }
  });
}

export function usePetMedications(crecheId: number, petId: number) {
  return useQuery({
    queryKey: ["medications", crecheId, petId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/medical/medications/${petId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar medicamentos");
      return res.json();
    }
  });
}

export function useCreateMedication(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/medical/medications`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error("Erro ao registrar medicamento");
      return res.json();
    },
    onSuccess: (_, { petId }) => {
      queryClient.invalidateQueries({ queryKey: ["medications", crecheId, petId] });
    }
  });
}

export function usePetIncidents(crecheId: number, petId: number) {
  return useQuery({
    queryKey: ["incidents", crecheId, petId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/medical/incidents/${petId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar incidentes");
      return res.json();
    }
  });
}

export function useCreateIncident(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/medical/incidents`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error("Erro ao registrar incidente");
      return res.json();
    },
    onSuccess: (_, { petId }) => {
      queryClient.invalidateQueries({ queryKey: ["incidents", crecheId, petId] });
    }
  });
}
