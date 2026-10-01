import React from "react";

export function AssistantTypingState() {
  return (
    <div
      className="flex items-center gap-1.5 py-2 px-3.5 rounded-2xl bg-muted/60 text-muted-foreground w-fit max-w-[80px]"
      role="status"
      aria-live="polite"
      aria-label="Assistente pensando"
    >
      <span className="sr-only">Assistente pensando...</span>
      <span
        className="w-2 h-2 rounded-full bg-primary/70 animate-bounce"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="w-2 h-2 rounded-full bg-primary/70 animate-bounce"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="w-2 h-2 rounded-full bg-primary/70 animate-bounce"
        style={{ animationDelay: "300ms" }}
      />
    </div>
  );
}
