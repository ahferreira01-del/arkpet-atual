import React, { useState, useRef, useEffect } from "react";
import { Send, Sparkles, ShieldAlert, RotateCcw, ArrowRight, Activity, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AssistantTypingState } from "./AssistantTypingState";
import { AssistantFeedback } from "./AssistantFeedback";
import { AssistantKnowledgeCitation } from "./AssistantKnowledgeCitation";
import { VoiceInputButton } from "./VoiceInputButton";
import { AssistantActionConfirmation } from "./AssistantActionConfirmation";
import { AssistantMessageContent } from "./AssistantMessageContent";
import type {
  AssistantUIMessage,
  AssistantVisualState,
  ScreenContextInfo,
  AssistantUIAction,
} from "./assistant.types";

interface AssistantConversationProps {
  messages: AssistantUIMessage[];
  status: AssistantVisualState;
  screenContext: ScreenContextInfo;
  userRole?: string;
  onSendMessage: (text: string) => void;
  onClearSession: () => void;
  onExecuteAction?: (action: AssistantUIAction) => void;
  onConfirmSafeAction?: (pendingActionId: string) => Promise<void>;
  onCancelSafeAction?: (pendingActionId: string) => Promise<void>;
}

export function AssistantConversation({
  messages,
  status,
  screenContext,
  userRole,
  onSendMessage,
  onClearSession,
  onExecuteAction,
  onConfirmSafeAction,
  onCancelSafeAction,
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
        "O que precisa da minha atenção agora?",
        "Quais pets ainda não comeram?",
        "Tem alguma medicação atrasada?",
        "Quem ainda está aguardando check-in?",
      ];
    }
    return [
      "Resumo operacional de hoje",
      "O que precisa da minha atenção agora?",
      "Quem ainda está aguardando check-in?",
      "Quais são os 5 passos do onboarding?",
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
                className={`max-w-[90%] sm:max-w-[85%] min-w-0 rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-xs"
                    : "bg-muted/70 text-foreground border border-border/40 rounded-bl-xs shadow-xs"
                }`}
              >
                {msg.role === "assistant" ? (
                  <AssistantMessageContent content={msg.content} />
                ) : (
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                )}

                {msg.role === "assistant" && msg.citations && (
                  <AssistantKnowledgeCitation citations={msg.citations} />
                )}

                {msg.role === "assistant" && msg.onboarding && (
                  <div className="mt-2 pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Progresso: {msg.onboarding.progressPercent}%</span>
                    {msg.onboarding.isComplete ? (
                      <span className="text-success font-medium">100% Concluído</span>
                    ) : (
                      <span>Próximo: {msg.onboarding.currentStep}</span>
                    )}
                  </div>
                )}

                {msg.role === "assistant" && msg.uiActions && msg.uiActions.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-border/40 flex flex-wrap gap-1.5">
                    {msg.uiActions.map((act, idx) => {
                      if (act.type === "navigate") {
                        const routeLabels: Record<string, string> = {
                          "/settings": "Ir para Configurações",
                          "/staff/manage": "Ir para Equipe",
                          "/tutors": "Ir para Tutores",
                          "/pets": "Ir para Pets",
                          "/bookings": "Ir para Reservas",
                        };
                        const label = routeLabels[act.route] || `Acessar ${act.route}`;
                        return (
                          <Button
                            key={idx}
                            size="sm"
                            variant="secondary"
                            onClick={() => onExecuteAction?.(act)}
                            className="h-7 text-xs px-2.5 rounded-lg border border-border/60 hover:border-primary/40 text-foreground flex items-center gap-1 cursor-pointer"
                          >
                            <span>{label}</span>
                            <ArrowRight className="h-3 w-3 text-primary" />
                          </Button>
                        );
                      }
                      if (act.type === "highlight") {
                        return (
                          <Button
                            key={idx}
                            size="sm"
                            variant="outline"
                            onClick={() => onExecuteAction?.(act)}
                            className="h-7 text-xs px-2.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 flex items-center gap-1 cursor-pointer"
                          >
                            <Sparkles className="h-3 w-3" />
                            <span>Destacar botão</span>
                          </Button>
                        );
                      }
                      return null;
                    })}
                  </div>
                )}

                {msg.role === "assistant" && msg.action && (
                  <AssistantActionConfirmation
                    action={msg.action}
                    onConfirm={async (id) => onConfirmSafeAction?.(id)}
                    onCancel={async (id) => onCancelSafeAction?.(id)}
                  />
                )}

                {msg.role === "assistant" && msg.operational && (
                  <div
                    data-testid="operational-card"
                    className="mt-3 p-3 rounded-xl bg-card border border-border/70 text-xs space-y-2.5 shadow-xs"
                  >
                    <div className="flex items-center justify-between font-medium text-foreground pb-1.5 border-b border-border/40">
                      <div className="flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-primary" />
                        <span>Copiloto Operacional</span>
                      </div>
                      {msg.operational.dataCompleteness === "partial" && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-normal">
                          Dados Parciais
                        </span>
                      )}
                    </div>

                    {/* Occupancy and Summary Chips */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px]">
                      <div data-testid="operational-occupancy" className="p-1.5 rounded-lg bg-muted/50 border border-border/30">
                        <span className="text-muted-foreground block text-[10px]">Ocupação</span>
                        <span className="font-semibold text-foreground">
                          {msg.operational.occupancy && msg.operational.occupancy.current !== null && msg.operational.occupancy.capacity !== null
                            ? `${msg.operational.occupancy.current}/${msg.operational.occupancy.capacity} pets`
                            : "Indisponível"}
                        </span>
                      </div>
                      <div data-testid="operational-arrivals" className="p-1.5 rounded-lg bg-muted/50 border border-border/30">
                        <span className="text-muted-foreground block text-[10px]">Chegadas</span>
                        <span className="font-semibold text-foreground">
                          {msg.operational.arrivals && msg.operational.arrivals.totalExpected !== null
                            ? `${msg.operational.arrivals.totalExpected} (${msg.operational.arrivals.pending ?? "?"} aguardando)`
                            : "Indisponível"}
                        </span>
                      </div>
                      <div data-testid="operational-tasks" className="p-1.5 rounded-lg bg-muted/50 border border-border/30 col-span-2 sm:col-span-1">
                        <span className="text-muted-foreground block text-[10px]">Tarefas</span>
                        <span className="font-semibold text-foreground">
                          {msg.operational.tasks && msg.operational.tasks.pending !== null
                            ? `${msg.operational.tasks.pending} (${msg.operational.tasks.overdue ?? "?"} atrasadas)`
                            : "Indisponível"}
                        </span>
                      </div>
                    </div>

                    {/* Priorities & Action Suggestions */}
                    {msg.operational.priorities && msg.operational.priorities.length > 0 && (
                      <div data-testid="operational-priorities" className="pt-1.5 border-t border-border/40 space-y-1.5">
                        <span className="text-[11px] font-medium text-foreground block">
                          Prioridades de Atenção:
                        </span>
                        {msg.operational.priorities.map((item, idx) => {
                          const priorityColors: Record<string, string> = {
                            critical: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
                            high: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
                            medium: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
                            low: "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/30",
                          };
                          const badgeColor = priorityColors[item.priority] || priorityColors.medium;

                          return (
                            <div
                              key={item.id || idx}
                              className="p-2 rounded-lg bg-muted/40 border border-border/40 text-[11px] space-y-1"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-foreground truncate">{item.title}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${badgeColor}`}>
                                  {item.priority.toUpperCase()}
                                </span>
                              </div>
                              <p className="text-muted-foreground text-[10px] leading-snug">{item.reason}</p>
                              {item.suggestedAction && (
                                <div className="pt-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => onSendMessage(item.suggestedAction!.label)}
                                    className="h-6 text-[10px] px-2 rounded-md border-primary/30 text-primary hover:bg-primary/10 flex items-center gap-1 cursor-pointer"
                                  >
                                    <span>{item.suggestedAction.label}</span>
                                    <ChevronRight className="w-3 h-3" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
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
          <VoiceInputButton
            onTranscript={(transcript) => {
              setInput(transcript);
              if (inputRef.current) {
                inputRef.current.focus();
              }
            }}
            disabled={status === "thinking"}
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
