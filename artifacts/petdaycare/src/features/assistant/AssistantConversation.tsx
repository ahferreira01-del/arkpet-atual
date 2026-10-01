import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, ShieldAlert, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssistantTypingState } from "./AssistantTypingState";
import { AssistantFeedback } from "./AssistantFeedback";
import { AssistantKnowledgeCitation } from "./AssistantKnowledgeCitation";
import type { AssistantUIMessage, AssistantVisualState, ScreenContextInfo } from "./assistant.types";

interface AssistantConversationProps {
  messages: AssistantUIMessage[];
  status: AssistantVisualState;
  screenContext: ScreenContextInfo;
  userRole?: string;
  onSendMessage: (text: string) => void;
  onClearSession: () => void;
}

export function AssistantConversation({
  messages,
  status,
  screenContext,
  userRole,
  onSendMessage,
  onClearSession,
}: AssistantConversationProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, status]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || status === "thinking") return;
    onSendMessage(trimmed);
    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  const getQuickSuggestions = (): string[] => {
    if (userRole === "tutor") {
      return [
        "Quais são os meus pets?",
        "Como solicito uma reserva?",
        "Qual a diferença entre hospedagem e day use?",
      ];
    }
    if (userRole === "staff") {
      return [
        "Como faço check-in por QR Code?",
        "Onde registro a alimentação?",
        "Como registrar um passeio?",
      ];
    }
    return [
      "Quais são os 5 passos do onboarding?",
      "Qual a diferença entre hospedagem e day use?",
      "Como cadastrar um pet?",
    ];
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Privacy Notice Banner */}
      <div className="bg-muted/40 border-b border-border/50 px-3 py-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span>Não informe senhas ou dados bancários ao assistente.</span>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={onClearSession}
            className="flex items-center gap-1 text-[11px] hover:text-foreground transition-colors cursor-pointer shrink-0 ml-2"
            title="Iniciar nova conversa"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="hidden sm:inline">Nova conversa</span>
          </button>
        )}
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-foreground text-sm">ArkPet Assistente</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-[260px]">
              Tire dúvidas sobre funcionalidades, reservas, rotinas operacionais ou navegação no sistema.
            </p>

            <div className="mt-6 w-full space-y-2">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Sugestões rápidas
              </span>
              {getQuickSuggestions().map((suggestion, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSendMessage(suggestion)}
                  className="w-full text-left text-xs bg-muted/50 hover:bg-muted p-2.5 rounded-xl border border-border/50 text-foreground transition-colors cursor-pointer"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-xs"
                    : "bg-muted/70 text-foreground border border-border/40 rounded-bl-xs shadow-xs"
                }`}
              >
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>

                {msg.role === "assistant" && msg.citations && (
                  <AssistantKnowledgeCitation citations={msg.citations} />
                )}
              </div>

              {msg.role === "assistant" && <AssistantFeedback messageId={msg.id} />}
            </div>
          ))
        )}

        {status === "thinking" && (
          <div className="flex flex-col items-start">
            <AssistantTypingState />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-border/60 bg-card/60 backdrop-blur-sm"
      >
        <div className="relative flex items-end gap-2 bg-background border border-border rounded-xl p-1.5 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua dúvida ou mensagem..."
            aria-label="Mensagem para o assistente"
            className="flex-1 bg-transparent resize-none border-0 text-xs sm:text-sm focus:outline-none p-1.5 max-h-[120px] custom-scrollbar text-foreground"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!input.trim() || status === "thinking"}
            aria-label="Enviar mensagem"
            className="h-8 w-8 p-0 rounded-lg shrink-0 cursor-pointer"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
