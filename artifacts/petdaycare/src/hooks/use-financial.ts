import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useTutorInvoices(crecheId: number, tutorId: number | undefined) {
  return useQuery({
    staleTime: 30 * 1000, // 30 segundos — permite ver baixa dada pelo admin rapidamente
    queryKey: ["tutor-invoices", crecheId, tutorId],
    queryFn: async () => {
      if (!tutorId) return [];
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices?tutorId=${tutorId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar faturas");
      return res.json();
    },
    enabled: !!crecheId && !!tutorId,
  });
}

export function useBookingConsumables(crecheId: number, bookingId: number | undefined) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["booking-consumables", crecheId, bookingId],
    queryFn: async () => {
      if (!bookingId) return [];
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/bookings/${bookingId}/consumables`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar consumíveis");
      return res.json();
    },
    enabled: !!crecheId && !!bookingId,
  });
}

export function useDeleteBookingConsumable(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, consumableId }: { bookingId: number, consumableId: number }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/bookings/${bookingId}/consumables/${consumableId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao remover consumível");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["booking-consumables"] });
    }
  });
}

export function useAddBookingConsumable(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, catalogueItemId, quantity, chargedPrice }: { bookingId: number, catalogueItemId: number, quantity: number, chargedPrice: number }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/bookings/${bookingId}/consumables`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ itemId: catalogueItemId, quantity, chargedPrice })
      });
      if (!res.ok) throw new Error("Erro ao adicionar consumível");
      return res.json();
    },
    onSuccess: (_, { bookingId }) => {
      queryClient.invalidateQueries({ queryKey: ["booking-consumables", crecheId, bookingId] });
      queryClient.invalidateQueries({ queryKey: ["all-invoices", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["tutor-invoices"] });
    }
  });
}

export function useFinancialCheckOut(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bookingId: number) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/bookings/${bookingId}/checkout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Erro ao realizar check-out financeiro");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["listBookings"] });
      queryClient.invalidateQueries({ queryKey: ["getPet"] });
      queryClient.invalidateQueries({ queryKey: ["listPets"] });
      queryClient.invalidateQueries({ queryKey: ["all-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["tutor-invoices"] });
    }
  });
}

export function useStripeCheckout(crecheId: number) {
  return useMutation({
    mutationFn: async ({ invoiceId }: { invoiceId: number }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/stripe-checkout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao gerar link de pagamento");
      return res.json();
    }
  });
}

export function useDashboardCashFlow(crecheId: number, startDate?: string, endDate?: string) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["cash-flow", crecheId, startDate, endDate],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      let url = `/api/creches/${crecheId}/financial/dashboard/cash-flow`;
      if (startDate && endDate) {
        url += `?startDate=${startDate}&endDate=${endDate}`;
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar fluxo de caixa");
      return res.json();
    }
  });
}

export function useDashboardDre(crecheId: number, startDate?: string, endDate?: string) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["dre", crecheId, startDate, endDate],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      let url = `/api/creches/${crecheId}/financial/dashboard/dre`;
      if (startDate && endDate) {
        url += `?startDate=${startDate}&endDate=${endDate}`;
      }
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar dre");
      return res.json();
    }
  });
}

export function useListAllInvoices(crecheId: number) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["all-invoices", crecheId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar faturas");
      return res.json();
    }
  });
}

export function useUpdateInvoiceStatus(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, status }: { invoiceId: number; status: string }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/status`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error("Erro ao atualizar status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["tutor-invoices"] });
    }
  });
}

export function usePayManualInvoice(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, paymentMethod }: { invoiceId: number; paymentMethod: string }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/pay-manual`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ paymentMethod })
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Erro ao baixar fatura manualmente");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["tutor-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["cash-flow"] });
      queryClient.invalidateQueries({ queryKey: ["dre"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    }
  });
}

export function useApproveReceipt(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: number) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/approve-receipt`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || "Erro ao aprovar comprovante");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["tutor-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["cash-flow"] });
      queryClient.invalidateQueries({ queryKey: ["dre"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    }
  });
}

export function useListExpenses(crecheId: number) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["expenses", crecheId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/expenses`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar despesas");
      return res.json();
    }
  });
}

export function useCreateExpense(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/expenses`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error("Erro ao criar despesa");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["cash-flow", crecheId] });
    }
  });
}

export function useUpdateExpense(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/expenses/${id}`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error("Erro ao atualizar despesa");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["cash-flow", crecheId] });
    }
  });
}

export function useDeleteExpense(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/expenses/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao deletar despesa");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["cash-flow", crecheId] });
    }
  });
}

export function usePayExpense(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (expenseId: number) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/expenses/${expenseId}/pay`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao pagar despesa");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["cash-flow", crecheId] });
    }
  });
}

export function useListCatalogue(crecheId: number) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["catalogue", crecheId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/catalogue`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar catálogo");
      return res.json();
    }
  });
}

export function usePurchasePackage(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tutorId, packageId, paymentMethod }: { tutorId: number; packageId: number; paymentMethod: 'stripe' | 'pix' }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/packages/purchase`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ tutorId, packageId, paymentMethod })
      });
      if (!res.ok) throw new Error("Erro ao comprar pacote");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-invoices"] });
    }
  });
}

export function usePackagesBalance(crecheId: number) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["packages-balance", crecheId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/packages/balance`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar saldo de pacotes");
      return res.json();
    }
  });
}

export function useServiceCredits(crecheId: number, params?: { page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ["service-credits", crecheId, params?.page, params?.pageSize],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const url = new URL(window.location.origin + `/api/creches/${crecheId}/financial/service-credits`);
      if (params?.page) url.searchParams.append("page", params.page.toString());
      if (params?.pageSize) url.searchParams.append("pageSize", params.pageSize.toString());
      
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar carteira de serviços");
      return res.json();
    }
  });
}

export function useInvoiceReceipt(crecheId: number, invoiceId: number | undefined) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["invoice-receipt", crecheId, invoiceId],
    queryFn: async () => {
      if (!invoiceId) return null;
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/receipt-url`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Comprovante não encontrado");
      return res.json();
    },
    enabled: !!crecheId && !!invoiceId,
    retry: false
  });
}

export function useCreateCatalogueItem(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: any) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/catalogue`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error("Erro ao criar item do catálogo");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalogue", crecheId] });
    }
  });
}

export function useUpdateCatalogueItem(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: any) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/catalogue/${id}`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || body?.message || `Erro ao atualizar item do catálogo (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalogue", crecheId] });
    }
  });
}

export function useArchiveCatalogueItem(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: number) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/catalogue/${itemId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao arquivar item");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalogue", crecheId] });
    }
  });
}

export function useDeleteCatalogueItem(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/catalogue/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao deletar item do catálogo");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalogue", crecheId] });
    }
  });
}

export function useRefundInvoice(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: number) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/refund`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao estornar fatura");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-invoices", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["cash-flow", crecheId] });
    }
  });
}

export function useVoidInvoice(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: number) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/void`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao cancelar fatura");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-invoices", crecheId] });
    }
  });
}

export function useTutorCreditsBalance(crecheId: number, tutorId: number | undefined) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["tutor-credits", crecheId, tutorId],
    queryFn: async () => {
      if (!tutorId) return { balance: 0, expiringAmount: 0 };
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/credits/balance?tutorId=${tutorId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar saldo de créditos");
      return res.json();
    },
    enabled: !!crecheId && !!tutorId,
  });
}

export function useInvoiceItems(crecheId: number, invoiceId: number | undefined) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["invoice-items", crecheId, invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/items`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar itens da fatura");
      return res.json();
    },
    enabled: !!invoiceId,
  });
}
export function useListAuditLogs(crecheId: number) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ['financialAuditLogs', crecheId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/audit`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar auditoria");
      return res.json();
    }
  });
}
export function useCreche(crecheId: number) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["creche", crecheId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao buscar dados da creche");
      return res.json();
    }
  });
}

export function useUpdateCrecheSettings(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: { auditEnabled: boolean }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Erro ao atualizar configurações");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["creche", crecheId] });
    }
  });
}

export function useListOrders(crecheId: number) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["orders", crecheId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/orders`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao buscar pedidos");
      return res.json();
    }
  });
}

export function useUpdateOrderStatus(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ orderId, status }: { orderId: number, status: string }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/orders/${orderId}/status`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ status })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao atualizar status do pedido");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", crecheId] });
    }
  });
}

export function useCreateOrder(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { items: { catalogueItemId: number, quantity: number }[], deliveryMethod: string, deliveryAddress?: string, deliveryFee: number }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/orders`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao criar pedido");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["catalogue", crecheId] });
    }
  });
}

export function usePosSale(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { items: { catalogueItemId: number, quantity: number }[], paymentMethod?: string, tutorId?: number }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/pos-sale`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao realizar venda balcão");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-invoices", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["catalogue", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-dre", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-cash-flow", crecheId] });
    }
  });
}

export function useRefundInvoiceItem(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ invoiceId, invoiceItemId, quantity }: { invoiceId: number, invoiceItemId: number, quantity: number }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/invoices/${invoiceId}/refund-item`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}` 
        },
        body: JSON.stringify({ invoiceItemId, quantity })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao estornar item da fatura");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-invoices", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["catalogue", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-dre", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-cash-flow", crecheId] });
      queryClient.invalidateQueries({ queryKey: ["audit-logs", crecheId] });
    }
  });
}

// ----------------------------------------------------------------------
// Analytics & Executive Dashboard Hooks
// ----------------------------------------------------------------------

export function useDashboardKPIs(crecheId: number, startDate?: string, endDate?: string) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["dashboard-kpis", crecheId, startDate, endDate],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const url = new URL(`/api/creches/${crecheId}/financial/dashboard/kpis`, window.location.origin);
      if (startDate) url.searchParams.append("startDate", startDate);
      if (endDate) url.searchParams.append("endDate", endDate);
      
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar KPIs");
      return res.json();
    },
    enabled: !!crecheId,
  });
}

export function useDashboardCharts(crecheId: number, startDate?: string, endDate?: string) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["dashboard-charts", crecheId, startDate, endDate],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const url = new URL(`/api/creches/${crecheId}/financial/dashboard/charts`, window.location.origin);
      if (startDate) url.searchParams.append("startDate", startDate);
      if (endDate) url.searchParams.append("endDate", endDate);
      
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar gráficos");
      return res.json();
    },
    enabled: !!crecheId,
  });
}

export function useDashboardSales(crecheId: number, startDate?: string, endDate?: string) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["dashboard-sales", crecheId, startDate, endDate],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const url = new URL(`/api/creches/${crecheId}/financial/dashboard/sales`, window.location.origin);
      if (startDate) url.searchParams.append("startDate", startDate);
      if (endDate) url.searchParams.append("endDate", endDate);
      
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar dashboard de vendas");
      return res.json();
    },
    enabled: !!crecheId,
  });
}

export function useFinancialReport(crecheId: number, type: string, startDate?: string, endDate?: string) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["financial-report", crecheId, type, startDate, endDate],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const url = new URL(`/api/creches/${crecheId}/financial/reports/${type}`, window.location.origin);
      if (startDate) url.searchParams.append("startDate", startDate);
      if (endDate) url.searchParams.append("endDate", endDate);
      
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao carregar relatório");
      return res.json();
    },
    enabled: !!crecheId && !!type,
  });
}

export function useFinancialSearch(crecheId: number, query: string) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ["financial-search", crecheId, query],
    queryFn: async () => {
      if (!query || query.length < 2) return { results: [] };
      const token = localStorage.getItem("auth_token");
      const url = new URL(`/api/creches/${crecheId}/financial/search`, window.location.origin);
      url.searchParams.append("q", query);
      
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao pesquisar");
      return res.json();
    },
    enabled: !!crecheId && query.length >= 2,
      });
}

export function useTutorSmartIndicators(crecheId: number, tutorId: number | undefined) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ['tutor-smart-indicators', crecheId, tutorId],
    queryFn: async () => {
      if (!tutorId) return null;
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/creches/${crecheId}/tutors/${tutorId}/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Falha ao buscar indicadores');
      return await res.json();
    },
    enabled: !!crecheId && !!tutorId,
      });
}

export function useCatalogueSmartIndicators(crecheId: number, itemId: number | undefined) {
  return useQuery({
    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching
    queryKey: ['catalogue-smart-indicators', crecheId, itemId],
    queryFn: async () => {
      if (!itemId) return null;
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`/api/creches/${crecheId}/financial/catalogue/${itemId}/stats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Falha ao buscar indicadores');
      return await res.json();
    },
    enabled: !!crecheId && !!itemId,
      });
}

export function useStockAdjustment(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, delta, reason }: { itemId: number; delta: number; reason: string }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/catalogue/${itemId}/stock-adjustment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ delta, reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao ajustar estoque");
      }
      return res.json();
    },
    onSuccess: (_, { itemId }) => {
      queryClient.invalidateQueries({ queryKey: ["stock-transactions", crecheId, itemId] });
      queryClient.invalidateQueries({ queryKey: ["catalogue", crecheId] });
    },
  });
}

export function useStockTransactions(crecheId: number, itemId: number | undefined, page = 1, pageSize = 20) {
  return useQuery({
    staleTime: 60 * 1000, // 1 minuto
    queryKey: ["stock-transactions", crecheId, itemId, page, pageSize],
    queryFn: async () => {
      if (!itemId) return { data: [], total: 0, page: 1, pageSize, totalPages: 0 };
      const token = localStorage.getItem("auth_token");
      const res = await fetch(
        `/api/creches/${crecheId}/financial/catalogue/${itemId}/stock-transactions?page=${page}&pageSize=${pageSize}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Erro ao carregar histórico de estoque");
      return res.json();
    },
    enabled: !!crecheId && !!itemId,
  });
}

export function useListBatches(crecheId: number, itemId: number) {
  return useQuery({
    queryKey: ["item-batches", crecheId, itemId],
    queryFn: async () => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/catalogue/${itemId}/batches`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Erro ao buscar lotes");
      return res.json();
    },
    enabled: !!crecheId && !!itemId,
  });
}

export function useCreateBatch(crecheId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, payload }: { itemId: number, payload: any }) => {
      const token = localStorage.getItem("auth_token");
      const res = await fetch(`/api/creches/${crecheId}/financial/catalogue/${itemId}/batches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao adicionar lote");
      }
      return res.json();
    },
    onSuccess: (_, { itemId }) => {
      queryClient.invalidateQueries({ queryKey: ["item-batches", crecheId, itemId] });
      queryClient.invalidateQueries({ queryKey: ["catalogue", crecheId] });
    }
  });
}
