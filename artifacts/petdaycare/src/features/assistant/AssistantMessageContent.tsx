import React, { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export interface AssistantMessageContentProps {
  content: string;
  className?: string;
}

const SAFE_PROTOCOLS = ["http:", "https:", "mailto:", "tel:"];

export function sanitizeMarkdownUrl(href?: string): string {
  if (!href) return "";
  const trimmed = href.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("#")) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed, "https://arkpet.local");
    if (SAFE_PROTOCOLS.includes(parsed.protocol)) {
      return trimmed;
    }
    return "";
  } catch {
    return "";
  }
}

export function AssistantMessageContent({ content, className = "" }: AssistantMessageContentProps) {
  const components: Components = useMemo(
    () => ({
      p: ({ children }) => (
        <p className="mb-2 last:mb-0 leading-relaxed break-words [overflow-wrap:anywhere]">
          {children}
        </p>
      ),
      strong: ({ children }) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      b: ({ children }) => (
        <strong className="font-semibold text-foreground">{children}</strong>
      ),
      em: ({ children }) => <em className="italic">{children}</em>,
      i: ({ children }) => <em className="italic">{children}</em>,
      ol: ({ children }) => (
        <ol className="list-decimal list-outside pl-5 mb-2 last:mb-0 space-y-1">
          {children}
        </ol>
      ),
      ul: ({ children }) => (
        <ul className="list-disc list-outside pl-5 mb-2 last:mb-0 space-y-1">
          {children}
        </ul>
      ),
      li: ({ children }) => (
        <li className="leading-relaxed pl-0.5 break-words [overflow-wrap:anywhere]">
          {children}
        </li>
      ),
      code: ({ className: codeClassName, children, ...props }) => {
        return (
          <code
            className="bg-muted/80 text-foreground font-mono text-[11px] sm:text-xs px-1.5 py-0.5 rounded-md border border-border/60 break-all select-all inline-block align-baseline"
            {...props}
          >
            {children}
          </code>
        );
      },
      pre: ({ children }) => (
        <pre className="my-2 p-2.5 bg-muted/60 dark:bg-muted/40 rounded-xl border border-border/50 overflow-x-auto max-w-full font-mono text-[11px] sm:text-xs text-foreground">
          {children}
        </pre>
      ),
      h1: ({ children }) => (
        <h1 className="text-sm sm:text-base font-semibold text-foreground mt-3 mb-1.5 first:mt-0">
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2 className="text-xs sm:text-sm font-semibold text-foreground mt-2.5 mb-1 first:mt-0">
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3 className="text-xs sm:text-sm font-medium text-foreground mt-2 mb-1 first:mt-0">
          {children}
        </h3>
      ),
      h4: ({ children }) => (
        <h4 className="text-xs sm:text-sm font-medium text-foreground mt-2 mb-1 first:mt-0">
          {children}
        </h4>
      ),
      blockquote: ({ children }) => (
        <blockquote className="border-l-2 border-primary/60 pl-2.5 my-2 italic text-muted-foreground text-xs sm:text-sm">
          {children}
        </blockquote>
      ),
      a: ({ href, children }) => {
        const safeHref = sanitizeMarkdownUrl(href);
        if (!safeHref) {
          return <span className="font-medium text-muted-foreground">{children}</span>;
        }
        return (
          <a
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity font-medium break-all"
          >
            {children}
          </a>
        );
      },
      hr: () => <hr className="my-2.5 border-border/50" />,
    }),
    []
  );

  return (
    <div
      data-testid="assistant-markdown-content"
      className={`assistant-message-content w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere] text-foreground text-xs sm:text-sm leading-relaxed ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={sanitizeMarkdownUrl}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
