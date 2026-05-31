import React, { useState, useRef, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import {
  useListConversations,
  useListMessages,
  useSendMessage,
  listMessages as fetchMessages,
  getListConversationsQueryKey,
} from "@workspace/api-client-react";
import type { ChatConversation } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Send, MessageSquare, ArrowLeft, Dog, Search, ChevronUp, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { parseUTC } from "@/lib/date-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface OptimisticMessage {
  id: string;
  senderId: number;
  senderName: string;
  content: string;
  createdAt: string;
  tutorId: number;
  petId?: number | null;
  petName?: string | null;
  optimistic: true;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const date = parseUTC(dateStr);
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return "ontem";
  return format(date, "dd/MM", { locale: ptBR });
}

function avatarInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

// ─── Conversation List Item ───────────────────────────────────────────────────

function ConversationItem({
  conv,
  isActive,
  onClick,
}: {
  conv: ChatConversation;
  isActive: boolean;
  onClick: () => void;
}) {
  const petList = conv.pets.map((p) => p.name).join(" · ") || "Sem pets";
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-3 rounded-xl flex items-center gap-3 transition-all ${
        isActive
          ? "bg-primary/15 border border-primary/25"
          : "hover:bg-white/5 border border-transparent"
      }`}
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-violet-500/30 to-purple-600/30 border border-white/10 flex items-center justify-center text-sm font-bold text-white">
        {avatarInitials(conv.tutorName)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`text-sm font-semibold truncate ${isActive ? "text-primary" : "text-white"}`}>
            {conv.tutorName}
          </p>
          {conv.lastAt && (
            <span className="text-[11px] text-muted-foreground flex-shrink-0">
              {relativeTime(conv.lastAt)}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
          {conv.lastMessage ?? petList}
        </p>
      </div>
      {conv.unread > 0 && (
        <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center shadow-[0_0_10px_rgba(139,92,246,0.5)]">
          {conv.unread > 99 ? "99+" : conv.unread}
        </span>
      )}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const isTutor = user?.role === "tutor";
  const searchStr = useSearch();
  const queryClient = useQueryClient();
  const token = localStorage.getItem("auth_token");

  const urlTutorId = searchStr
    ? parseInt(new URLSearchParams(searchStr).get("tutor") ?? "", 10) || undefined
    : undefined;

  const [selectedTutorId, setSelectedTutorId] = useState<number | undefined>(
    isTutor ? user?.id : urlTutorId
  );
  const [showConversation, setShowConversation] = useState(isTutor || !!urlTutorId);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [taggedPetId, setTaggedPetId] = useState<number | undefined>();
  const [showPetPicker, setShowPetPicker] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [olderMessages, setOlderMessages] = useState<any[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [allOlderLoaded, setAllOlderLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const petPickerRef = useRef<HTMLDivElement>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: conversations, isLoading: convLoading } = useListConversations(crecheId, {
    query: { refetchInterval: 10000, staleTime: 0 } as any,
  });

  const selectedConv = conversations?.find((c) => c.tutorId === selectedTutorId);

  const { data: serverMessages, isLoading: msgsLoading } = useListMessages(
    crecheId,
    selectedTutorId ? { tutorId: selectedTutorId } : undefined,
    {
      query: {
        enabled: !!selectedTutorId,
        refetchInterval: 8000,
        staleTime: 0,
      } as any,
    }
  );

  const allMessages = React.useMemo(() => {
    const server = (serverMessages ?? []) as any[];
    const serverIds = new Set(server.map((m) => m.id));
    const dedupedOlder = olderMessages.filter((m) => !serverIds.has(m.id));
    const dedupeOpt = optimisticMessages.filter(
      (om) =>
        !server.some(
          (sm) => sm.content === om.content && sm.senderId === om.senderId
        )
    );
    return [...dedupedOlder, ...server, ...dedupeOpt].sort(
      (a, b) => parseUTC(a.createdAt).getTime() - parseUTC(b.createdAt).getTime()
    );
  }, [olderMessages, serverMessages, optimisticMessages]);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (isTutor && user?.id) {
      setSelectedTutorId(user.id);
      setShowConversation(true);
    } else if (urlTutorId) {
      setSelectedTutorId(urlTutorId);
      setShowConversation(true);
    }
  }, [urlTutorId, isTutor, user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length]);

  useEffect(() => {
    setOlderMessages([]);
    setAllOlderLoaded(false);
    setTaggedPetId(undefined);
    setOptimisticMessages([]);
  }, [selectedTutorId]);

  useEffect(() => {
    if (!serverMessages?.length || !optimisticMessages.length) return;
    setOptimisticMessages((prev) =>
      prev.filter(
        (om) =>
          !(serverMessages as any[]).some(
            (sm) => sm.content === om.content && sm.senderId === om.senderId
          )
      )
    );
  }, [serverMessages]);

  useEffect(() => {
    if (!selectedTutorId || !user?.crecheId) return;
    fetch(`/api/creches/${crecheId}/chat/mark-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tutorId: selectedTutorId }),
    })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["chat-unread", crecheId] });
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey(crecheId) });
      })
      .catch(() => {});
  }, [selectedTutorId]);

  // Close pet picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (petPickerRef.current && !petPickerRef.current.contains(e.target as Node)) {
        setShowPetPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const sendMutation = useSendMessage();

  const handleSelectConversation = (tutorId: number) => {
    setSelectedTutorId(tutorId);
    setShowConversation(true);
  };

  const [, setLocation] = useLocation();
  const handleBack = () => {
    if (isTutor) {
      setLocation("/");
    } else {
      setShowConversation(false);
    }
  };

  const handleLoadOlder = async () => {
    if (!selectedTutorId || loadingOlder || allOlderLoaded) return;
    const combined = [...olderMessages, ...(serverMessages ?? [])];
    const oldest = (combined as any[]).sort((a, b) => a.id - b.id)[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const older = await fetchMessages(crecheId, {
        tutorId: selectedTutorId,
        cursor: oldest.id,
        limit: 50,
      });
      if (!older.length || older.length < 50) setAllOlderLoaded(true);
      setOlderMessages((prev) => {
        const existingIds = new Set(prev.map((m: any) => m.id));
        return [...older.filter((m) => !existingIds.has(m.id)), ...prev];
      });
    } catch {}
    setLoadingOlder(false);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !selectedTutorId || !user) return;
    const content = message.trim();
    setMessage("");
    const taggedPet = selectedConv?.pets.find((p) => p.id === taggedPetId);
    const optimistic: OptimisticMessage = {
      id: `opt-${Date.now()}`,
      senderId: user.id,
      senderName: user.name,
      content,
      createdAt: new Date().toISOString(),
      tutorId: selectedTutorId,
      petId: taggedPetId ?? null,
      petName: taggedPet?.name ?? null,
      optimistic: true,
    };
    setOptimisticMessages((prev) => [...prev, optimistic]);
    sendMutation.mutate(
      { crecheId, data: { tutorId: selectedTutorId, petId: taggedPetId ?? null, content } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            predicate: (q) => String(q.queryKey[0]).includes("/chat"),
          });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey(crecheId) });
        },
        onError: () => {
          setOptimisticMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
          setMessage(content);
        },
      }
    );
  };

  const filteredConversations = (conversations ?? []).filter(
    (c) =>
      c.tutorName.toLowerCase().includes(search.toLowerCase()) ||
      c.pets.some((p) => p.name.toLowerCase().includes(search.toLowerCase()))
  );

  // ── Conversation View (Tela B) ─────────────────────────────────────────────

  const conversationView = (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex-shrink-0 flex items-center gap-3">
        <button
          onClick={handleBack}
          className="md:hidden p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-white transition-colors flex-shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {selectedConv?.tutorName ?? "..."}
          </p>
          {(selectedConv?.pets.length ?? 0) > 0 && (
            <div className="flex gap-1 mt-0.5 flex-wrap">
              {selectedConv!.pets.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-white/5 border border-white/10 px-1.5 py-0.5 rounded-full"
                >
                  <Dog className="h-2.5 w-2.5" />
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-emerald-400 flex-shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          ao vivo
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3 min-h-0">
        {!allOlderLoaded && (serverMessages?.length ?? 0) >= 50 && (
          <div className="flex justify-center mb-2">
            <button
              onClick={handleLoadOlder}
              disabled={loadingOlder}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full transition-colors disabled:opacity-50"
            >
              <ChevronUp className="h-3 w-3" />
              {loadingOlder ? "Carregando..." : "Ver mensagens anteriores"}
            </button>
          </div>
        )}

        {msgsLoading && !olderMessages.length ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Carregando mensagens...
          </div>
        ) : allMessages.length ? (
          <>
            {allMessages.map((msg: any) => {
              const isOwn = msg.senderId === user?.id;
              const isOptimistic = !!msg.optimistic;
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col gap-0.5 ${isOwn ? "items-end" : "items-start"} ${isOptimistic ? "opacity-75" : ""}`}
                >
                  <p className="text-xs text-muted-foreground px-1">{msg.senderName}</p>
                  {msg.petName && (
                    <div className="px-1">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          isOwn
                            ? "bg-primary/20 text-primary border border-primary/30"
                            : "bg-white/10 text-muted-foreground border border-white/10"
                        }`}
                      >
                        <Dog className="h-2.5 w-2.5" />
                        {msg.petName}
                      </span>
                    </div>
                  )}
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
                    {format(parseUTC(msg.createdAt), "HH:mm", { locale: ptBR })}
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
            description="Inicie a conversa."
          />
        )}
      </div>

      {/* Input */}
      <div className="p-3 md:p-4 border-t border-white/10 flex-shrink-0">
        {taggedPetId && selectedConv && (
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-primary/20 text-primary border border-primary/30">
              <Dog className="h-3 w-3" />
              {selectedConv.pets.find((p) => p.id === taggedPetId)?.name}
              <button
                type="button"
                onClick={() => setTaggedPetId(undefined)}
                className="ml-0.5 hover:text-white transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        <form onSubmit={handleSend} className="flex gap-2">
          {(selectedConv?.pets.length ?? 0) > 0 && (
            <div className="relative" ref={petPickerRef}>
              <button
                type="button"
                onClick={() => setShowPetPicker((v) => !v)}
                className={`h-11 px-3 rounded-xl border transition-colors flex items-center gap-1.5 text-xs font-medium flex-shrink-0 ${
                  taggedPetId
                    ? "bg-primary/20 border-primary/40 text-primary"
                    : "bg-white/5 border-white/10 text-muted-foreground hover:text-white hover:bg-white/10"
                }`}
              >
                <Dog className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Pet</span>
              </button>
              {showPetPicker && (
                <div className="absolute bottom-full mb-2 left-0 bg-slate-800 border border-white/10 rounded-xl shadow-xl z-50 min-w-[140px] p-1">
                  {selectedConv!.pets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setTaggedPetId(taggedPetId === p.id ? undefined : p.id);
                        setShowPetPicker(false);
                      }}
                      className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                        taggedPetId === p.id
                          ? "bg-primary/20 text-primary"
                          : "text-white hover:bg-white/5"
                      }`}
                    >
                      <Dog className="h-3.5 w-3.5 flex-shrink-0" />
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Mensagem..."
            className="flex-1 h-11"
          />
          <Button
            type="submit"
            disabled={!message.trim()}
            className="h-11 px-4 flex-shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );

  // ── List View (Tela A) ────────────────────────────────────────────────────

  const listView = (
    <div className="flex flex-col h-full min-h-0">
      <div className="relative mb-3 flex-shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar tutor ou pet..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-0.5 min-h-0">
        {convLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>
        ) : filteredConversations.length ? (
          filteredConversations.map((conv) => (
            <ConversationItem
              key={conv.tutorId}
              conv={conv}
              isActive={selectedTutorId === conv.tutorId}
              onClick={() => handleSelectConversation(conv.tutorId)}
            />
          ))
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="Nenhuma conversa"
            description="Nenhum tutor cadastrado ainda."
          />
        )}
      </div>
    </div>
  );

  // ── Layout ────────────────────────────────────────────────────────────────

  const pageHeaderAction = (
    <div className="flex items-center gap-1.5 text-xs text-emerald-400 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
      Ao vivo
    </div>
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── PageHeader — hidden on mobile when inside a conversation ── */}
      <div className={`mb-4 ${showConversation ? "hidden md:block" : "block"}`}>
        <PageHeader
          title="Mensagens"
          description="Conversas em tempo real com os tutores."
          icon={MessageSquare}
          action={pageHeaderAction}
        />
      </div>

      {/* ── MOBILE: conversation list (only when not inside a conversation) ── */}
      {!isTutor && (
        <div className={`md:hidden ${showConversation ? "hidden" : "flex flex-col"}`}>
          {listView}
        </div>
      )}

      {/* ── MOBILE: conversation as a fixed full-screen overlay ──────────────
          Sits between the app header (h-16 = 4rem) and the bottom nav
          (72px + safe-area). This bypasses the overflow-y:auto main container
          so the input is never clipped by the bottom nav spacer.            */}
      {(isTutor || showConversation) && (
        <div
          className="md:hidden fixed inset-x-0 z-30 flex flex-col"
          style={{
            top: "4rem",
            bottom: "calc(72px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-card border-t border-white/10">
            {selectedTutorId ? (
              conversationView
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState
                  icon={MessageSquare}
                  title="Selecione uma conversa"
                  description="Escolha um tutor para visualizar as mensagens."
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── DESKTOP: side-by-side layout ──────────────────────────────────── */}
      <div className="hidden md:flex gap-4 h-[calc(100dvh-13rem)] min-h-0">
        {!isTutor && (
          <div className="w-72 flex-shrink-0 flex flex-col min-h-0">
            {listView}
          </div>
        )}
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <CardContent className="p-0 flex flex-col h-full min-h-0">
            {selectedTutorId ? (
              conversationView
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState
                  icon={MessageSquare}
                  title="Selecione uma conversa"
                  description="Escolha um tutor para visualizar as mensagens."
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
