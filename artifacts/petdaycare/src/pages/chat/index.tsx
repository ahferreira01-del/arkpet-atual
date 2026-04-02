import React, { useState, useRef, useEffect } from "react";
import { useListMessages, useSendMessage, useListPets } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Send, MessageSquare, Dog, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

export default function Chat() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const [selectedPetId, setSelectedPetId] = useState<number | undefined>(undefined);
  const [message, setMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: pets } = useListPets(crecheId);
  const { data: messages, isLoading } = useListMessages(crecheId, selectedPetId ? { petId: selectedPetId } : {});
  const sendMutation = useSendMessage();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    sendMutation.mutate(
      { crecheId, data: { content: message, petId: selectedPetId } },
      {
        onSuccess: () => {
          setMessage("");
          queryClient.invalidateQueries({ queryKey: ["/api/creches/{crecheId}/chat"] });
        },
      }
    );
  };

  const selectedPetName = pets?.find((p) => p.id === selectedPetId)?.name;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-10rem)] animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Page title - compact on mobile */}
      <div className="mb-3 flex-shrink-0">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-white">Mensagens</h1>
        <p className="text-sm text-muted-foreground mt-0.5 hidden md:block">
          Converse com a equipe da creche sobre seus pets.
        </p>
      </div>

      {/* Mobile: compact pet filter as horizontal scroll */}
      {pets && pets.length > 0 && (
        <div className="flex md:hidden gap-2 overflow-x-auto pb-2 flex-shrink-0 custom-scrollbar">
          <button
            onClick={() => setSelectedPetId(undefined)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              !selectedPetId
                ? "bg-primary text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]"
                : "bg-white/10 text-muted-foreground"
            }`}
          >
            Todos
          </button>
          {pets.map((pet) => (
            <button
              key={pet.id}
              onClick={() => setSelectedPetId(pet.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                selectedPetId === pet.id
                  ? "bg-primary text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]"
                  : "bg-white/10 text-muted-foreground"
              }`}
            >
              <Dog className="h-3 w-3" />
              {pet.name}
            </button>
          ))}
        </div>
      )}

      {/* Main chat area */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Desktop sidebar */}
        <div className="hidden md:flex w-52 flex-shrink-0 flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">
            Filtrar por Pet
          </p>
          <button
            onClick={() => setSelectedPetId(undefined)}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              !selectedPetId
                ? "bg-primary/20 text-primary border border-primary/20"
                : "text-muted-foreground hover:bg-white/5 hover:text-white"
            }`}
          >
            Todas as Conversas
          </button>
          {pets?.map((pet) => (
            <button
              key={pet.id}
              onClick={() => setSelectedPetId(pet.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all ${
                selectedPetId === pet.id
                  ? "bg-primary/20 text-primary border border-primary/20"
                  : "text-muted-foreground hover:bg-white/5 hover:text-white"
              }`}
            >
              <Dog className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{pet.name}</span>
            </button>
          ))}
        </div>

        {/* Messages panel */}
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Chat header (mobile only) */}
          <div className="md:hidden px-4 py-2 border-b border-white/10 flex-shrink-0">
            <p className="text-xs text-muted-foreground">
              {selectedPetName ? (
                <span className="text-primary font-medium flex items-center gap-1">
                  <Dog className="h-3 w-3" /> {selectedPetName}
                </span>
              ) : (
                "Todas as conversas"
              )}
            </p>
          </div>

          <CardContent className="p-0 flex flex-col h-full min-h-0">
            {/* Messages list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 space-y-3 min-h-0">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Carregando mensagens...
                </div>
              ) : messages?.length ? (
                <>
                  {messages.map((msg) => {
                    const isOwn = msg.senderId === user?.id;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col gap-0.5 ${isOwn ? "items-end" : "items-start"}`}
                      >
                        <p className="text-xs text-muted-foreground px-1">
                          {msg.senderName}
                          {msg.petName && (
                            <span className="text-primary"> • {msg.petName}</span>
                          )}
                        </p>
                        <div
                          className={`max-w-[80%] md:max-w-md px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                            isOwn
                              ? "bg-primary text-white rounded-br-md shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                              : "bg-white/10 text-white rounded-bl-md border border-white/10"
                          }`}
                        >
                          {msg.content}
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
                  description="Inicie a conversa com a equipe da creche."
                />
              )}
            </div>

            {/* Message input */}
            <form
              onSubmit={handleSend}
              className="p-3 md:p-4 border-t border-white/10 flex gap-2 flex-shrink-0"
            >
              {pets && pets.length > 0 && (
                <div className="relative hidden md:block flex-shrink-0">
                  <select
                    value={selectedPetId || ""}
                    onChange={(e) =>
                      setSelectedPetId(e.target.value ? Number(e.target.value) : undefined)
                    }
                    className="h-11 rounded-xl border border-white/10 bg-black/20 pl-3 pr-8 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md appearance-none w-32"
                  >
                    <option value="">Geral</option>
                    {pets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Digite sua mensagem..."
                className="flex-1 h-11"
              />
              <Button
                type="submit"
                isLoading={sendMutation.isPending}
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
