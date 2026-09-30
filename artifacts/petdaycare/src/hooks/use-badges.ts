import { useQuery } from "@tanstack/react-query";
import { UserProfile } from "@workspace/api-client-react";

/**
 * Shared badge queries for Sidebar and BottomNav.
 * Setting staleTime: 15_000 prevents duplicate simultaneous fetches when both
 * desktop and mobile layout elements are mounted or re-rendered in AppLayout.
 */

export function usePendingBookingsBadge(user: UserProfile) {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  const { data } = useQuery({
    queryKey: ["bookings-badge", user?.crecheId],
    queryFn: async () => {
      if (!user?.crecheId) return 0;
      const [pendingRes, cancelRes] = await Promise.all([
        fetch(`/api/creches/${user.crecheId}/bookings?status=pending`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/creches/${user.crecheId}/bookings?status=cancel_requested`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const pending = pendingRes.ok ? await pendingRes.json() : { total: 0 };
      const cancelRequested = cancelRes.ok ? await cancelRes.json() : { total: 0 };
      return (
        (pending.total ?? pending.items?.length ?? 0) +
        (cancelRequested.total ?? cancelRequested.items?.length ?? 0)
      );
    },
    enabled: !!user?.crecheId && (user?.role === "creche_admin" || user?.role === "staff"),
    refetchInterval: 20_000,
    staleTime: 15_000,
  });
  return (data ?? 0) as number;
}

export function useFinancialBadge(user: UserProfile) {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  const { data } = useQuery({
    queryKey: ["financial-awaiting-count", user?.crecheId],
    queryFn: async () => {
      if (!user?.crecheId) return { count: 0 };
      const r = await fetch(
        `/api/creches/${user.crecheId}/financial/invoices/awaiting-count`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return r.ok ? r.json() : { count: 0 };
    },
    enabled: !!user?.crecheId && (user?.role === "creche_admin" || user?.role === "staff"),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  return (data?.count ?? 0) as number;
}

export function useTutorInvoiceBadge(user: UserProfile) {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  const { data } = useQuery({
    queryKey: ["tutor-invoices", user?.crecheId, user?.id],
    queryFn: async () => {
      if (!user?.crecheId || !user?.id) return [];
      const r = await fetch(
        `/api/creches/${user.crecheId}/financial/invoices?tutorId=${user.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      return r.ok ? r.json() : [];
    },
    enabled: !!user?.crecheId && user?.role === "tutor",
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const invoices: any[] = data?.data ?? (Array.isArray(data) ? data : []);
  return invoices.filter((inv: any) => inv.status === "pending" || inv.status === "overdue").length;
}

export function useChatUnread(user: UserProfile) {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  const { data } = useQuery({
    queryKey: ["chat-unread", user?.crecheId],
    queryFn: async () => {
      if (!user?.crecheId) return { total: 0 };
      const r = await fetch(`/api/creches/${user.crecheId}/chat/unread`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return r.ok ? r.json() : { total: 0 };
    },
    enabled: !!user?.crecheId,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  return (data?.total ?? 0) as number;
}
