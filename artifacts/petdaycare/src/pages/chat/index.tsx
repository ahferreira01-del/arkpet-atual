import React, { useState, useRef, useEffect } from "react";
import { useListMessages, useSendMessage, useListPets } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Send, MessageSquare, Dog } from "lucide-react";
import { format } from "date-fns";
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 h-[calc(100vh-12rem)] flex flex-col">
      <div>
        <h1 className="text-3xl font-display font-bold text-white">Messages</h1>
        <p className="text-muted-foreground mt-1">Chat with the daycare team about your pets.</p>
      </div>

      <div className="flex gap-6 flex-1 min-h-0">
        {/* Sidebar: pet filter */}
        <div className="w-56 flex-shrink-0 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-3">Filter by Pet</p>
          <button
            onClick={() => setSelectedPetId(undefined)}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
              !selectedPetId ? "bg-primary/20 text-primary border border-primary/20" : "text-muted-foreground hover:bg-white/5 hover:text-white"
            }`}
          >
            All Conversations
          </button>
          {pets?.map((pet) => (
            <button
              key={pet.id}
              onClick={() => setSelectedPetId(pet.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all ${
                selectedPetId === pet.id ? "bg-primary/20 text-primary border border-primary/20" : "text-muted-foreground hover:bg-white/5 hover:text-white"
              }`}
            >
              <Dog className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{pet.name}</span>
            </button>
          ))}
        </div>

        {/* Chat area */}
        <Card className="flex-1 flex flex-col min-h-0">
          <CardContent className="p-0 flex flex-col h-full">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4 min-h-0">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">Loading messages...</div>
              ) : messages?.length ? (
                <>
                  {messages.map((msg) => {
                    const isOwn = msg.senderId === user?.id;
                    return (
                      <div key={msg.id} className={`flex flex-col gap-1 ${isOwn ? "items-end" : "items-start"}`}>
                        <p className="text-xs text-muted-foreground px-1">
                          {msg.senderName} {msg.petName && <span className="text-primary">• {msg.petName}</span>}
                        </p>
                        <div
                          className={`max-w-md px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                            isOwn
                              ? "bg-primary text-white rounded-br-md shadow-[0_0_20px_rgba(139,92,246,0.3)]"
                              : "bg-white/10 text-white rounded-bl-md border border-white/10"
                          }`}
                        >
                          {msg.content}
                        </div>
                        <p className="text-xs text-muted-foreground/60 px-1">
                          {format(new Date(msg.createdAt), "h:mm a")}
                        </p>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </>
              ) : (
                <EmptyState
                  icon={MessageSquare}
                  title="No messages yet"
                  description="Start the conversation with the daycare team."
                />
              )}
            </div>

            {/* Input */}
            <form onSubmit={handleSend} className="p-4 border-t border-white/10 flex gap-3">
              {pets && pets.length > 0 && (
                <select
                  value={selectedPetId || ""}
                  onChange={(e) => setSelectedPetId(e.target.value ? Number(e.target.value) : undefined)}
                  className="h-12 rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md flex-shrink-0 w-32"
                >
                  <option value="">General</option>
                  {pets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message..."
                className="flex-1"
              />
              <Button type="submit" isLoading={sendMutation.isPending} className="px-5">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
