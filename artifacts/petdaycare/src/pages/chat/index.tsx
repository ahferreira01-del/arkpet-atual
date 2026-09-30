import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
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
import { Send, MessageSquare, ArrowLeft, Dog, Search, ChevronUp, X, ChevronRight, Paperclip, AlertCircle, RotateCcw, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { parseUTC } from "@/lib/date-utils";
import { resolvePhotoUrl, uploadFileDirect } from "@/lib/utils";

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
  mediaUrl?: string | null;
  optimistic: true;
  status: "sending" | "failed";
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
      className={`w-full text-left p-4 rounded-3xl flex items-center gap-4 transition-all mb-2 border ${
        isActive
          ? "bg-card border-primary ring-1 ring-primary/20 shadow-sm"
          : "bg-card border-border hover:border-border/80 opacity-90 hover:opacity-100"
      }`}
    >
      <div className="relative shrink-0">
         <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-[15px] font-bold text-foreground">
           {avatarInitials(conv.tutorName)}
         </div>
         <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-card rounded-full flex items-center justify-center">
            <div className="h-2.5 w-2.5 bg-success rounded-full" />
         </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className={`text-[15px] font-semibold truncate ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
            {conv.tutorName}
          </p>
          {conv.lastAt && (
            <span className="text-[12px] font-medium text-muted-foreground shrink-0">
              {relativeTime(conv.lastAt)}
            </span>
          )}
        </div>
        <p className="text-[13px] text-muted-foreground truncate">
          {conv.lastMessage ?? petList}
        </p>
      </div>
      {conv.unread > 0 ? (
        <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">
          {conv.unread > 99 ? "99+" : conv.unread}
        </span>
      ) : (
        <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
      )}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Chat() {
  const { user } = useAuth();
  const crecheId = user?.role === "master_admin" ? null : (user?.crecheId ?? null);
  const isTutor = user?.role === "tutor";
  const searchStr = useSearch();
  const queryClient = useQueryClient();
  const token = localStorage.getItem("auth_token");
  const { toast } = useToast();

  const urlTutorId = searchStr
    ? parseInt(new URLSearchParams(searchStr).get("tutor") ?? "", 10) || undefined
    : undefined;

  const [selectedTutorId, setSelectedTutorId] = useState<number | undefined>(
    isTutor ? user?.id : urlTutorId
  );
  const [showConversation, setShowConversation] = useState(isTutor || !!urlTutorId);
  // ROOT CAUSE FIX: conversationView used to be rendered TWICE (mobile overlay
  // + desktop card, one hidden by CSS). scrollContainerRef/messagesEndRef can
  // only point at ONE element and ended up bound to the HIDDEN desktop copy
  // (height 0), so the landing scroll "succeeded" against a zero-height div
  // while the visible mobile container was never scrolled. Render exactly one
  // copy per breakpoint via matchMedia so the refs always target the visible DOM.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [taggedPetId, setTaggedPetId] = useState<number | undefined>();
  const [showPetPicker, setShowPetPicker] = useState(false);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [olderMessages, setOlderMessages] = useState<any[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [allOlderLoaded, setAllOlderLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const initialScrolledRef = useRef(false);
  // B (F6.1): tracks USER INTENT to remain at the bottom — updated by the real
  // scroll event, NOT recalculated after a resize. This separates intent from the
  // post-resize distance, so a large image loading (+500px) doesn't flip intent
  // to false and leave the viewport stranded mid-history.
  const shouldStickToBottomRef = useRef(true);
  const petPickerRef = useRef<HTMLDivElement>(null);

  // ── Data ──────────────────────────────────────────────────────────────────

  const { data: conversations, isLoading: convLoading } = useListConversations(crecheId ?? 0, {
    query: { refetchInterval: 10000, staleTime: 0 } as any,
  });

  const selectedConv = conversations?.find((c) => c.tutorId === selectedTutorId);

  const { data: serverMessages, isLoading: msgsLoading } = useListMessages(
    crecheId ?? 0,
    selectedTutorId ? { tutorId: selectedTutorId } : undefined,
    {
      query: {
        refetchInterval: 5000,
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
        om.status === "failed" ||
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

  // Reset scroll sentinels SYNCHRONOUSLY when the conversation changes.
  // MUST be declared BEFORE the landing effect below: effects run in
  // declaration order within the same commit, so the landing effect must
  // already see initialScrolledRef = false when selectedTutorId changes —
  // otherwise it takes the smooth-scroll branch with the stale sentinel and
  // a cached conversation with the same message count never re-lands.
  useLayoutEffect(() => {
    if (!selectedTutorId) return;
    initialScrolledRef.current = false;
    shouldStickToBottomRef.current = true;
    // isDesktop dep: on breakpoint switch the container REMOUNTS (only one
    // copy is rendered per breakpoint), so the landing must run again.
  }, [selectedTutorId, isDesktop]);

  // F9: scroll to the latest message.
  // - First load: useLayoutEffect fires synchronously BEFORE the browser paints,
  //   so the first visible frame already shows the newest messages (no flash to top).
  //   Only marks initialScrolledRef=true once the scroll actually landed at the
  //   bottom (distanceToBottom < 10). If the layout hasn't settled yet (scrollHeight
  //   still 0 or images not loaded), a single requestAnimationFrame retries and then
  //   marks initialized unconditionally — the ResizeObserver in the next effect
  //   handles any remaining content shifts after that.
  // - New message: smooth scroll only when user intent (shouldStickToBottomRef) is true.
  // Deps include `showConversation` so the effect re-fires when the mobile
  // overlay mounts (showConversation: false → true), giving the scroll container
  // a chance to be in the DOM after the initial render where it was absent.
  useLayoutEffect(() => {
    if (!allMessages.length) return;
    const container = scrollContainerRef.current;
    if (!initialScrolledRef.current) {
      // Container absent (mobile overlay not yet mounted) — leave the sentinel
      // false so the effect re-fires when `showConversation` mounts it.
      if (!container) return;

      // Persistent landing loop: force scrollTop to the bottom every frame
      // until the scroll actually LANDS (dist < 10) — or ~0.5 s passes.
      // A single-frame retry is not enough on slow mobile devices where
      // fonts/layout settle across several frames after first paint.
      let attempts = 0;
      let cancelled = false;
      const land = () => {
        if (cancelled) return;
        container.scrollTop = container.scrollHeight;
        const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (dist < 10) {
          initialScrolledRef.current = true;
          shouldStickToBottomRef.current = true;
        } else if (attempts++ < 30) {
          requestAnimationFrame(land);
        } else {
          // Give up trying to verify — mark initialized so the stick-to-bottom
          // ResizeObserver takes over from here.
          initialScrolledRef.current = true;
          shouldStickToBottomRef.current = true;
        }
      };
      land();
      return () => {
        cancelled = true;
      };
    } else if (shouldStickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    return undefined;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMessages.length, showConversation, selectedTutorId, isDesktop]);

  // F5/B: keep anchored to the bottom during layout shifts (images loading, etc.)
  // Uses shouldStickToBottomRef (user intent) — NOT post-resize distance.
  // This prevents a large image (+500 px) from flipping the near-bottom check
  // to false and stranding the viewport mid-history (B1–B8).
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // B5/B9: track user intent via the real scroll event.
    // Programmatic scrolls (scrollTop = scrollHeight) also fire this handler,
    // but they land exactly at the bottom so dist ≈ 0 < 120 → intent stays true.
    const onScroll = () => {
      if (!initialScrolledRef.current) return;
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      shouldStickToBottomRef.current = dist < 120;
    };
    container.addEventListener("scroll", onScroll, { passive: true });

    // B7: ResizeObserver reads intent ref (set before resize) — not post-resize distance.
    const observer = new ResizeObserver(() => {
      if (!initialScrolledRef.current) return;
      if (shouldStickToBottomRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      // B9: intent = false → user is reading history → do nothing.
    });
    observer.observe(container);
    // Also observe the CONTENT wrapper: the container itself is flex-1 (fixed
    // size), so content growth (fonts loading, new bubbles reflowing) never
    // resizes it — only the inner wrapper grows. Without this, the viewport
    // gets stranded mid-history when content height settles after the initial
    // scroll on slow mobile devices.
    if (contentRef.current) observer.observe(contentRef.current);

    return () => {
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
    // isDesktop: the container remounts on breakpoint switch — re-attach.
  }, [selectedTutorId, isDesktop]);

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
          om.status === "failed" ||
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
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey(crecheId ?? 0) });
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

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Tipo de arquivo inválido",
        description: "Selecione uma imagem (PNG, JPG, WebP).",
        variant: "destructive",
      });
      return;
    }
    setSelectedFile(file);
    const objectUrl = URL.createObjectURL(file);
    setFilePreview(objectUrl);
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    if (filePreview) {
      URL.revokeObjectURL(filePreview);
      setFilePreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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
    if (!crecheId || !selectedTutorId || loadingOlder || allOlderLoaded) return;
    const combined = [...olderMessages, ...(serverMessages ?? [])];
    const oldest = (combined as any[]).sort((a, b) => a.id - b.id)[0];
    if (!oldest) return;
    const container = scrollContainerRef.current;
    const prevScrollHeight = container ? container.scrollHeight : 0;
    const prevScrollTop = container ? container.scrollTop : 0;
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
      requestAnimationFrame(() => {
        if (container) {
          const delta = container.scrollHeight - prevScrollHeight;
          container.scrollTop = prevScrollTop + delta;
        }
      });
    } catch {
      toast({
        title: "Erro ao carregar mensagens",
        description: "Não foi possível carregar o histórico de mensagens.",
        variant: "destructive",
      });
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleRetry = (msg: OptimisticMessage) => {
    if (!crecheId) return;
    setOptimisticMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, status: "sending" } : m))
    );
    sendMutation.mutate(
      {
        crecheId,
        data: {
          tutorId: msg.tutorId,
          petId: msg.petId ?? null,
          content: msg.content,
          mediaUrl: msg.mediaUrl ?? undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            predicate: (q) => String(q.queryKey[0]).includes("/chat"),
          });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey(crecheId ?? 0) });
        },
        onError: () => {
          setOptimisticMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, status: "failed" } : m))
          );
          toast({
            title: "Erro ao reenviar",
            description: "A mensagem ainda não pôde ser enviada. Verifique sua conexão.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!crecheId || (!message.trim() && !selectedFile) || !selectedTutorId || !user) return;
    const content = message.trim();
    const currentFile = selectedFile;
    const currentPreview = filePreview;
    const taggedPet = selectedConv?.pets.find((p) => p.id === taggedPetId);

    let uploadedMediaUrl: string | null = null;
    if (currentFile) {
      setIsUploadingFile(true);
      try {
        uploadedMediaUrl = await uploadFileDirect(currentFile, token || "");
      } catch {
        setIsUploadingFile(false);
        toast({
          title: "Erro no envio do anexo",
          description: "Não foi possível carregar a imagem.",
          variant: "destructive",
        });
        return;
      }
      setIsUploadingFile(false);
    }

    setMessage("");
    handleClearFile();

    const optimistic: OptimisticMessage = {
      id: `opt-${Date.now()}`,
      senderId: user.id,
      senderName: user.name,
      content,
      createdAt: new Date().toISOString(),
      tutorId: selectedTutorId,
      petId: taggedPetId ?? null,
      petName: taggedPet?.name ?? null,
      mediaUrl: uploadedMediaUrl || currentPreview,
      optimistic: true,
      status: "sending",
    };
    setOptimisticMessages((prev) => [...prev, optimistic]);

    sendMutation.mutate(
      {
        crecheId,
        data: {
          tutorId: selectedTutorId,
          petId: taggedPetId ?? null,
          content,
          mediaUrl: uploadedMediaUrl ?? undefined,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            predicate: (q) => String(q.queryKey[0]).includes("/chat"),
          });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey(crecheId ?? 0) });
        },
        onError: () => {
          setOptimisticMessages((prev) =>
            prev.map((m) => (m.id === optimistic.id ? { ...m, status: "failed" } : m))
          );
          toast({
            title: "Erro ao enviar mensagem",
            description: "Não foi possível entregar a mensagem. Toque em 'Tentar novamente'.",
            variant: "destructive",
          });
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
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex-shrink-0 flex items-center gap-3 bg-card shadow-sm z-10 relative">
        <button
          onClick={handleBack}
          className="md:hidden h-11 w-11 -ml-2 rounded-xl hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {selectedConv?.tutorName ?? "..."}
          </p>
          {(selectedConv?.pets.length ?? 0) > 0 && (
            <div className="flex gap-1 mt-1 flex-wrap">
              {selectedConv!.pets.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-secondary px-2 py-0.5 rounded-full"
                >
                  <Dog className="h-2.5 w-2.5" />
                  {p.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-success flex-shrink-0 bg-success/10 px-2.5 py-1 rounded-full uppercase tracking-wider">
          <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
          Online
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar p-4 min-h-0 bg-background">
        {/* Content wrapper — observed by the ResizeObserver so content growth
            (not just container resize) keeps the viewport pinned to bottom. */}
        <div ref={contentRef} className="flex flex-col space-y-4 min-h-full">
        {!allOlderLoaded && (serverMessages?.length ?? 0) >= 50 && (
          <div className="flex justify-center mb-4">
            <button
              onClick={handleLoadOlder}
              disabled={loadingOlder}
              className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground bg-secondary hover:bg-secondary/80 px-4 py-2 rounded-full transition-colors disabled:opacity-50 min-h-[44px]"
            >
              <ChevronUp className="h-4 w-4" />
              {loadingOlder ? "Carregando..." : "Ver mensagens anteriores"}
            </button>
          </div>
        )}

        {msgsLoading && !olderMessages.length ? (
          <div className="text-center py-8 text-muted-foreground text-sm font-medium">
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
                  className={`flex flex-col gap-1 ${isOwn ? "items-end" : "items-start"} ${isOptimistic ? "opacity-70" : ""}`}
                >
                  <div className="flex items-baseline gap-2 px-1">
                    <span className="text-[11px] font-medium text-muted-foreground">{msg.senderName}</span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {format(parseUTC(msg.createdAt), "HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  {msg.petName && (
                    <div className="px-1 mb-0.5">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          isOwn
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : "bg-secondary text-muted-foreground border border-border"
                        }`}
                      >
                        <Dog className="h-2.5 w-2.5" />
                        {msg.petName}
                      </span>
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] md:max-w-md px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed shadow-sm ${
                      isOwn
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-card text-card-foreground rounded-tl-sm border border-border"
                    } ${isOptimistic && msg.status === "failed" ? "border border-destructive ring-1 ring-destructive/40" : ""}`}
                  >
                    {msg.mediaUrl && (
                      <div className="mb-2 overflow-hidden rounded-xl">
                        <img
                          src={resolvePhotoUrl(msg.mediaUrl) || msg.mediaUrl}
                          alt="Anexo"
                          className="max-h-60 w-full object-cover rounded-xl"
                          loading="lazy"
                        />
                      </div>
                    )}
                    {msg.content ? <div>{msg.content}</div> : null}
                    {isOptimistic && msg.status === "sending" && (
                      <span className="block mt-1.5 text-primary-foreground/70 text-[10px] font-bold uppercase tracking-wider">
                        Enviando...
                      </span>
                    )}
                    {isOptimistic && msg.status === "failed" && (
                      <div className="mt-2 pt-1.5 border-t border-destructive/20 flex items-center justify-between gap-3 text-destructive text-[11px] font-medium">
                        <span className="flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" />
                          Falha ao enviar
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRetry(msg)}
                          className="inline-flex items-center gap-1 font-bold underline hover:opacity-80 active:scale-95 transition-transform"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Tentar novamente
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} className="h-2" />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              icon={MessageSquare}
              title="Nenhuma mensagem ainda"
              description="Inicie a conversa."
            />
          </div>
        )}
        </div>
      </div>

      {/* Input */}
      <div className="p-3 md:p-4 border-t border-border flex-shrink-0 bg-card shadow-sm relative z-10">
        {selectedFile && (
          <div className="flex items-center gap-2 mb-2 p-1.5 bg-secondary/80 rounded-xl border border-border inline-flex">
            {filePreview && (
              <img src={filePreview} alt="Preview" className="h-8 w-8 rounded-lg object-cover" />
            )}
            <span className="text-xs truncate max-w-[150px] font-medium text-foreground">
              {selectedFile.name}
            </span>
            <button
              type="button"
              onClick={handleClearFile}
              className="p-1 hover:bg-background rounded-full text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {taggedPetId && selectedConv && (
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full bg-primary text-primary-foreground">
              <Dog className="h-3.5 w-3.5" />
              {selectedConv.pets.find((p) => p.id === taggedPetId)?.name}
              <button
                type="button"
                onClick={() => setTaggedPetId(undefined)}
                className="ml-1 -mr-1 h-5 w-5 rounded-full flex items-center justify-center hover:bg-primary-foreground/20 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        <form onSubmit={handleSend} className="flex gap-2 items-end">
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploadingFile}
            className={`h-[44px] px-3.5 rounded-2xl transition-colors flex items-center justify-center gap-2 text-[13px] font-medium flex-shrink-0 min-w-[44px] ${
              selectedFile
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80"
            }`}
            title="Anexar imagem"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          {(selectedConv?.pets.length ?? 0) > 0 && (
            <div className="relative" ref={petPickerRef}>
              <button
                type="button"
                onClick={() => setShowPetPicker((v) => !v)}
                className={`h-[44px] px-3.5 rounded-2xl transition-colors flex items-center justify-center gap-2 text-[13px] font-medium flex-shrink-0 min-w-[44px] ${
                  taggedPetId
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                }`}
              >
                <Dog className="h-4 w-4" />
              </button>
              {showPetPicker && (
                <div className="absolute bottom-[calc(100%+8px)] left-0 bg-popover border border-border rounded-xl shadow-xl z-50 min-w-[160px] p-1.5">
                  <div className="px-2 py-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    Vincular Pet
                  </div>
                  {selectedConv!.pets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setTaggedPetId(taggedPetId === p.id ? undefined : p.id);
                        setShowPetPicker(false);
                      }}
                      className={`w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[14px] font-medium transition-colors min-h-[44px] ${
                        taggedPetId === p.id
                          ? "bg-primary text-primary-foreground"
                          : "text-popover-foreground hover:bg-secondary"
                      }`}
                    >
                      <Dog className="h-4 w-4 flex-shrink-0" />
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 bg-background border border-border rounded-2xl flex items-center px-1 overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all shadow-sm">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escreva uma mensagem..."
              className="flex-1 min-h-[44px] border-0 shadow-none focus-visible:ring-0 bg-transparent text-[16px] px-3 py-0"
            />
          </div>
          <Button
            type="submit"
            disabled={(!message.trim() && !selectedFile) || isUploadingFile || sendMutation.isPending}
            className="h-[44px] w-[44px] p-0 flex items-center justify-center flex-shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl shadow-none transition-transform active:scale-95"
          >
            {isUploadingFile ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5 ml-0.5" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );

  // ── List View (Tela A) ────────────────────────────────────────────────────

  const listView = (
    <div className="flex flex-col h-full min-h-0 bg-background md:bg-transparent">
      <div className="relative mb-4 flex-shrink-0 px-4 md:px-0 pt-4 md:pt-0">
        <Search className="absolute left-7 md:left-3 top-[calc(50%+8px)] md:top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar tutor ou pet..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 min-h-[44px] rounded-2xl bg-card border border-border text-[16px] md:text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 shadow-sm"
        />
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1 min-h-0 px-4 md:px-0 pb-4">
        {convLoading ? (
          <div className="text-center py-8 text-muted-foreground text-[15px] font-medium">Carregando conversas...</div>
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
          <div className="h-full flex items-center justify-center pb-12">
            <EmptyState
              icon={MessageSquare}
              title="Nenhuma conversa"
              description="Nenhum tutor cadastrado ainda."
            />
          </div>
        )}
      </div>
    </div>
  );

  // ── Layout ────────────────────────────────────────────────────────────────

  const pageHeaderAction = (
    <div className="flex items-center gap-1.5 text-xs text-success font-semibold px-2.5 py-1.5 rounded-full bg-success/10 border border-success/20 uppercase tracking-wider">
      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
      Ao vivo
    </div>
  );

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── PageHeader — hidden on mobile when inside a conversation ── */}
      <div className={`mb-4 md:mb-6 ${showConversation ? "hidden md:block" : "block"} px-4 md:px-0`}>
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
      {!isDesktop && (isTutor || showConversation) && (
        <div
          className="md:hidden fixed inset-x-0 z-30 flex flex-col shadow-2xl"
          style={{
            top: "4rem",
            bottom: "calc(72px + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background border-t border-border">
            {selectedTutorId ? (
              conversationView
            ) : (
              <div className="flex-1 flex items-center justify-center p-6">
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
      {isDesktop && (
      <div className="hidden md:flex gap-6 h-[calc(100dvh-14rem)] min-h-0 px-4 md:px-0">
        {!isTutor && (
          <div className="w-80 flex-shrink-0 flex flex-col min-h-0">
            {listView}
          </div>
        )}
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden bg-background border-border rounded-[2rem] shadow-sm">
          <CardContent className="p-0 flex flex-col h-full min-h-0">
            {selectedTutorId ? (
              conversationView
            ) : (
              <div className="flex-1 flex items-center justify-center bg-card">
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
      )}
    </div>
  );
}
