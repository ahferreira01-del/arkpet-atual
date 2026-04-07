import React, { useState, useRef, useEffect, useCallback } from "react";
import { useListMessages, useSendMessage, useListPets } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Send, MessageSquare, Dog, Search } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient, useQuery } from "@tanstack/react-query";

interface OptimisticMessage {
  id: string;
  senderId: number;
  senderName: string;
  content: string;
  createdAt: string;
  petId: number;
  optimistic: true;
}

function useUnreadByPet(crecheId: number) {
  const token = localStorage.getItem("auth_token");
  const { data } = useQuery({
    queryKey: ["chat-unread", crecheId],
    queryFn: async () => {
      const r = await fetch(`/api/creches/${crecheId}/chat/unread`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return r.ok ? r.json() : { total: 0, byPet: {} };
    },
    refetchInterval: 10000,
  });
  return (data?.byPet ?? {}) as Record<number, number>;
}

export default function Chat() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const token = localStorage.getItem("auth_token");

  const { data: pets } = useListPets(crecheId);
  const unreadByPet = useUnreadByPet(crecheId);

  const firstPetId = pets?.[0]?.id;
  const [selectedPetId, setSelectedPetId] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (firstPetId && selectedPetId === undefined) {
      setSelectedPetId(firstPetId);
    }
  }, [firstPetId]);

  // On mount: mark ALL unread messages as read (user opened the inbox)
  // This clears the bottom-nav badge immediately
  useEffect(() => {
    if (!user?.crecheId) return;
    const doMarkAll = async () => {
      try {
        await fetch(`/api/creches/${crecheId}/chat/mark-read`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({}), // no petId = mark ALL as read
        });
        queryClient.invalidateQueries({ queryKey: ["chat-unread", crecheId] });
      } catch {}
    };
    doMarkAll();
  }, [crecheId]); // runs once on mount

  const { data: serverMessages, isLoading } = useListMessages(
    crecheId,
    selectedPetId ? { petId: selectedPetId } : {}
  );
  const sendMutation = useSendMessage();

  // Merge server messages with optimistic — deduplicate by content+time
  const messages = React.useMemo(() => {
    const serverIds = new Set((serverMessages ?? []).map((m: any) => m.id));
    const filtered = optimisticMessages.filter(
      (om) => !serverMessages?.some(
        (sm: any) => sm.content === om.content && sm.senderId === om.senderId
      )
    );
    return [...(serverMessages ?? []), ...filtered].sort(
      (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [serverMessages, optimisticMessages]);

  // Polling for new messages every 8 seconds (true refetch, no stale key)
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes("/chat") });
      queryClient.invalidateQueries({ queryKey: ["chat-unread", crecheId] });
    }, 8000);
    return () => clearInterval(interval);
  }, [crecheId]);

  // Auto-scroll whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Clean up confirmed optimistic messages after server syncs
  useEffect(() => {
    if (!serverMessages?.length || !optimisticMessages.length) return;
    setOptimisticMessages((prev) =>
      prev.filter(
        (om) => !serverMessages.some(
          (sm: any) => sm.content === om.content && sm.senderId === om.senderId
        )
      )
    );
  }, [serverMessages]);

  // Mark as read when selecting a pet
  const markAsRead = useCallback(async (petId: number) => {
    try {
      await fetch(`/api/creches/${crecheId}/chat/mark-read`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ petId }),
      });
      queryClient.invalidateQueries({ queryKey: ["chat-unread", crecheId] });
    } catch {}
  }, [crecheId, token]);

  const handleSelectPet = (petId: number) => {
    setSelectedPetId(petId);
    setOptimisticMessages([]); // clear optimistic when switching pets
    markAsRead(petId);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !selectedPetId || !user) return;

    const content = message.trim();
    setMessage("");

    // ── Optimistic update: show message immediately ──
    const optimisticMsg: OptimisticMessage = {
      id: `opt-${Date.now()}`,
      senderId: user.id,
      senderName: user.name,
      content,
      createdAt: new Date().toISOString(),
      petId: selectedPetId,
      optimistic: true,
    };
    setOptimisticMessages((prev) => [...prev, optimisticMsg]);

    sendMutation.mutate(
      { crecheId, data: { content, petId: selectedPetId } },
      {
        onSuccess: () => {
          // Server confirmed — invalidate to get the official message
          queryClient.invalidateQueries({
            predicate: (q) => String(q.queryKey[0]).includes("/chat"),
          });
        },
        onError: () => {
          // Remove the optimistic message if send failed
          setOptimisticMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
          setMessage(content); // restore the message text
        },
      }
    );
  };

  const selectedPet = pets?.find((p) => p.id === selectedPetId);

  const filteredPets = pets?.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.tutorName as any)?.toLowerCase?.()?.includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-10rem)] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-3 flex-shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold text-white">Mensagens</h1>
          <p className="text-sm text-muted-foreground mt-0.5 hidden md:block">
            Conversas em tempo real vinculadas a cada pet.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          Ao vivo
        </div>
      </div>

      {/* Mobile: pet chips */}
      {pets && pets.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 flex-shrink-0 custom-scrollbar mb-2 md:hidden">
          {filteredPets.map((pet) => {
            const unread = unreadByPet[pet.id] ?? 0;
            return (
              <button
                key={pet.id}
                onClick={() => handleSelectPet(pet.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all relative ${
                  selectedPetId === pet.id
                    ? "bg-primary text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]"
                    : "bg-white/10 text-muted-foreground hover:bg-white/15 hover:text-white"
                }`}
              >
                <Dog className="h-3.5 w-3.5 flex-shrink-0" />
                {pet.name}
                {unread > 0 && (
                  <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Main layout */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Desktop sidebar with search */}
        <div className="hidden md:flex w-60 flex-shrink-0 flex-col gap-1">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar pet ou tutor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
            Conversas
          </p>
          <div className="overflow-y-auto custom-scrollbar flex flex-col gap-0.5">
            {filteredPets.length > 0 ? (
              filteredPets.map((pet) => {
                const unread = unreadByPet[pet.id] ?? 0;
                return (
                  <button
                    key={pet.id}
                    onClick={() => handleSelectPet(pet.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all ${
                      selectedPetId === pet.id
                        ? "bg-primary/20 text-primary border border-primary/20"
                        : "text-muted-foreground hover:bg-white/5 hover:text-white border border-transparent"
                    }`}
                  >
                    <Dog className="h-4 w-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">{pet.name}</p>
                      {(pet as any).tutorName && (
                        <p className="text-xs text-muted-foreground truncate">{(pet as any).tutorName}</p>
                      )}
                    </div>
                    {unread > 0 && (
                      <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <p className="text-xs text-muted-foreground px-1 mt-2">Nenhum pet encontrado.</p>
            )}
          </div>
        </div>

        {/* Messages panel */}
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {selectedPet && (
            <div className="px-4 py-2.5 border-b border-white/10 flex-shrink-0 flex items-center gap-2">
              <Dog className="h-4 w-4 text-primary" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-white">{selectedPet.name}</span>
                {(selectedPet as any).tutorName && (
                  <span className="text-xs text-muted-foreground ml-2">• {(selectedPet as any).tutorName}</span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-emerald-400 flex-shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                ao vivo
              </div>
            </div>
          )}

          <CardContent className="p-0 flex flex-col h-full min-h-0">
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-5 space-y-3 min-h-0">
              {!selectedPetId ? (
                <EmptyState
                  icon={Dog}
                  title="Selecione um pet"
                  description="Escolha um pet para ver e enviar mensagens."
                />
              ) : isLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Carregando mensagens...</div>
              ) : messages?.length ? (
                <>
                  {messages.map((msg: any) => {
                    const isOwn = msg.senderId === user?.id;
                    const isOptimistic = (msg as any).optimistic;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col gap-0.5 ${isOwn ? "items-end" : "items-start"} ${isOptimistic ? "opacity-80" : ""}`}
                      >
                        <p className="text-xs text-muted-foreground px-1">{msg.senderName}</p>
                        <div
                          className={`max-w-[80%] md:max-w-md px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                            isOwn
                              ? "bg-primary text-white rounded-br-md shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                              : "bg-white/10 text-white rounded-bl-md border border-white/10"
                          }`}
                        >
                          {msg.content}
                          {isOptimistic && (
                            <span className="ml-2 text-white/50 text-[10px]">enviando…</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground/60 px-1">
                          {format(new Date(msg.createdAt), "HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </>
              ) : (
                <EmptyState
                  icon={MessageSquare}
                  title="Nenhuma mensagem ainda"
                  description="Inicie a conversa sobre este pet."
                />
              )}
            </div>

            <form
              onSubmit={handleSend}
              className="p-3 md:p-4 border-t border-white/10 flex gap-2 flex-shrink-0"
            >
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={selectedPetId ? `Mensagem sobre ${selectedPet?.name || "o pet"}...` : "Selecione um pet para enviar mensagem"}
                disabled={!selectedPetId}
                className="flex-1 h-11"
              />
              <Button
                type="submit"
                disabled={!selectedPetId || !message.trim()}
                className="h-11 px-4 flex-shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
