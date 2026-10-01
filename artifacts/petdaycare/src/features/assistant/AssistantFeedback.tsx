import React, { useState } from "react";
import { ThumbsUp, ThumbsDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssistantFeedbackProps {
  messageId: string;
}

export function AssistantFeedback({ messageId }: AssistantFeedbackProps) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  const handleFeedback = (type: "up" | "down") => {
    setFeedback(type);
    try {
      localStorage.setItem(`assistant_feedback_${messageId}`, type);
    } catch {
      // Safe fallback
    }
  };

  if (feedback) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80 mt-1">
        <Check className="w-3.5 h-3.5 text-green-500" />
        <span>Obrigado pelo feedback!</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 mt-1 text-muted-foreground/70">
      <button
        type="button"
        onClick={() => handleFeedback("up")}
        className={cn(
          "p-1 rounded-md hover:bg-muted/80 hover:text-foreground transition-colors cursor-pointer",
          feedback === "up" && "text-primary font-bold"
        )}
        aria-label="Resposta útil"
        title="Resposta útil"
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => handleFeedback("down")}
        className={cn(
          "p-1 rounded-md hover:bg-muted/80 hover:text-foreground transition-colors cursor-pointer",
          feedback === "down" && "text-destructive font-bold"
        )}
        aria-label="Resposta não ajudou"
        title="Resposta não ajudou"
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
