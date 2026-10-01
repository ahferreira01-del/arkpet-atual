import React from "react";
import { BookOpen } from "lucide-react";
import type { AssistantCitation } from "./assistant.types";

interface AssistantKnowledgeCitationProps {
  citations: AssistantCitation[];
}

export function AssistantKnowledgeCitation({ citations }: AssistantKnowledgeCitationProps) {
  if (!citations || citations.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap gap-1.5">
      {citations.map((c, index) => (
        <span
          key={index}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full"
          title={`Fonte: ${c.path}`}
        >
          <BookOpen className="w-3 h-3 text-primary/70" />
          <span>Baseado em: {c.title}</span>
        </span>
      ))}
    </div>
  );
}
