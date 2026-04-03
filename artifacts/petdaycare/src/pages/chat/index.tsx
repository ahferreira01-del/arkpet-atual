import React, { useState, useRef, useEffect } from "react";
import { useListMessages, useSendMessage, useListPets } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Send, MessageSquare, Dog } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";

export default function Chat() {
  const { user } = useAuth();
  const crecheId = user?.crecheId || 1;
  const [message, setMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: pets } = useListPets(crecheId);

  const firstPetId = pets?.[0]?.id;
  const [selectedPetId, setSelectedPetId] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (firstPetId && selectedPetId === undefined) {
      setSelectedPetId(firstPetId);
    }
  }, [firstPetId]);

  const { data: messages, isLoading } = useListMessages(
    crecheId,
    selectedPetId ? { petId: selectedPetId } : {}
  );
  const sendMutation = useSendMessage();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !selectedPetId) return;
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

  const selectedPet = pets?.find((p) => p.id === selectedPetId);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-10rem)] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-3 flex-shrink-0">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-white">Mensagens</h1>
        <p className="text-sm text-muted-foreground mt-0.5 hidden md:block">
          Conversas vinculadas a cada pet.
        </p>
      </div>

      {/* Pet chips - always visible */}
      {pets && pets.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-2 flex-shrink-0 custom-scrollbar mb-2">
          {pets.map((pet) => (
            <button
              key={pet.id}
              onClick={() => setSelectedPetId(pet.id)}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                selectedPetId === pet.id
                  ? "bg-primary text-white shadow-[0_0_12px_rgba(139,92,246,0.4)]"
                  : "bg-white/10 text-muted-foreground hover:bg-white/15 hover:text-white"
              }`}
            >
              <Dog className="h-3.5 w-3.5 flex-shrink-0" />
              {pet.name}
            </button>
          ))}
        </div>
      ) : null}

      {/* Main layout */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Desktop sidebar */}
        <div className="hidden md:flex w-52 flex-shrink-0 flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">
            Conversa por Pet
          </p>
          {pets && pets.length > 0 ? (
            pets.map((pet) => (
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
            ))
          ) : (
            <p className="text-xs text-muted-foreground px-1 mt-2">Nenhum pet cadastrado.</p>
          )}
        </div>

        {/* Messages panel */}
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {selectedPet && (
            <div className="px-4 py-2.5 border-b border-white/10 flex-shrink-0 flex items-center gap-2">
              <Dog className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-white">{selectedPet.name}</span>
              <span className="text-xs text-muted-foreground">— conversa exclusiva</span>
            </div>
          )}

          <CardContent className="p-0 flex flex-col h-full min-h-0">
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-5 space-y-3 min-h-0">
              {!selectedPetId ? (
                <EmptyState
                  icon={Dog}
                  title="Selecione um pet"
                  description="Escolha um pet acima para ver e enviar mensagens."
                />
              ) : isLoading ? (
                <div className="text-center py-8 text-muted-foreground text-sm">Carregando mensagens...</div>
              ) : messages?.length ? (
                <>
                  {messages.map((msg) => {
                    const isOwn = msg.senderId === user?.id;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col gap-0.5 ${isOwn ? "items-end" : "items-start"}`}
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
                isLoading={sendMutation.isPending}
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
