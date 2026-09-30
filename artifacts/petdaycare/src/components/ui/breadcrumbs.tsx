import * as React from "react";
import { Link } from "wouter";
import { ChevronRight, Home, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: LucideIcon;
}

export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
  showHome?: boolean;
  homeHref?: string;
  separator?: React.ReactNode;
}

export function Breadcrumbs({
  items,
  showHome = false,
  homeHref = "/",
  separator,
  className,
  ...props
}: BreadcrumbsProps) {
  const allItems: BreadcrumbItem[] = showHome
    ? [{ label: "Início", href: homeHref, icon: Home }, ...items]
    : items;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center text-xs text-muted-foreground", className)}
      {...props}
    >
      <ol className="flex items-center flex-wrap gap-1.5">
        {allItems.map((item, index) => {
          const isLast = index === allItems.length - 1;
          const Icon = item.icon;

          return (
            <li key={`${item.label}-${index}`} className="inline-flex items-center gap-1.5">
              {index > 0 && (
                <span className="opacity-40 select-none" aria-hidden="true">
                  {separator || <ChevronRight className="h-3.5 w-3.5" />}
                </span>
              )}

              {isLast ? (
                <span
                  className="font-medium text-foreground truncate max-w-[200px] sm:max-w-none inline-flex items-center gap-1"
                  aria-current="page"
                >
                  {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                  {item.label}
                </span>
              ) : item.href ? (
                <Link
                  href={item.href}
                  className="hover:text-foreground transition-colors inline-flex items-center gap-1 hover:underline underline-offset-4"
                >
                  {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                  {item.label}
                </Link>
              ) : item.onClick ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="hover:text-foreground transition-colors inline-flex items-center gap-1 hover:underline underline-offset-4"
                >
                  {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                  {item.label}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1">
                  {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
