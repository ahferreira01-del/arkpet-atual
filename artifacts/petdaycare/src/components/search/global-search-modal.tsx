import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { Badge } from "@/components/ui/badge";
import {
  Dog,
  User,
  Calendar,
  Building,
  Users,
  Loader2,
  CornerDownLeft,
  ArrowUpDown,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchResultItem {
  id: string | number;
  type: "pet" | "tutor" | "booking" | "creche" | "user";
  title: string;
  subtitle?: string;
  url: string;
  badge?: string;
}

export interface SearchGroup {
  type: "pet" | "tutor" | "booking" | "creche" | "user";
  label: string;
  items: SearchResultItem[];
}

export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
  total: number;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  pet: <Dog className="h-4 w-4 text-primary" />,
  tutor: <User className="h-4 w-4 text-info" />,
  booking: <Calendar className="h-4 w-4 text-warning" />,
  creche: <Building className="h-4 w-4 text-success" />,
  user: <Users className="h-4 w-4 text-primary" />,
};

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GlobalSearchModal({ isOpen, onClose }: GlobalSearchModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [, setLocation] = useLocation();
  const listRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(searchTerm, 300);

  // Reset search term when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

  const { data, isLoading, isFetching } = useQuery<SearchResponse>({
    queryKey: ["global-search", debouncedQuery],
    queryFn: async ({ signal }) => {
      if (!debouncedQuery || debouncedQuery.trim().length < 2) {
        return { query: debouncedQuery, groups: [], total: 0 };
      }
      const res = await fetch(`/api/search?q=${encodeURIComponent(debouncedQuery.trim())}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal,
      });
      if (!res.ok) {
        throw new Error("Erro na busca");
      }
      return res.json();
    },
    enabled: isOpen && debouncedQuery.trim().length >= 2,
    staleTime: 1000 * 30,
  });

  const allItems = data?.groups?.flatMap((g) => g.items) || [];

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [debouncedQuery, data]);

  const handleSelectItem = (item: SearchResultItem) => {
    onClose();
    setLocation(item.url);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (allItems.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % allItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + allItems.length) % allItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = allItems[selectedIndex];
      if (selected) {
        handleSelectItem(selected);
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Busca Global"
      description="Pesquise por pets, tutores, reservas e creches"
      className="max-w-xl p-0 overflow-hidden"
    >
      <div className="flex flex-col max-h-[80vh] w-full" onKeyDown={handleKeyDown}>
        {/* Search Input Box */}
        <div className="p-4 border-b border-border bg-background sticky top-0 z-10">
          <div className="relative flex items-center">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              onClear={() => setSearchTerm("")}
              placeholder="Digite o nome de um pet, tutor ou reserva..."
              autoFocus
              className="h-12 text-base"
            />
            {isFetching && (
              <div className="absolute right-12 flex items-center pointer-events-none">
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
              </div>
            )}
          </div>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[50vh] custom-scrollbar"
          role="listbox"
          aria-label="Resultados da busca"
        >
          {searchTerm.trim().length < 2 && (
            <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
              <Search className="h-8 w-8 text-muted-foreground/40" />
              <span>Digite pelo menos 2 caracteres para buscar...</span>
            </div>
          )}

          {searchTerm.trim().length >= 2 && !isLoading && allItems.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
              <Search className="h-8 w-8 text-muted-foreground/40" />
              <span>Nenhum resultado encontrado para &quot;{searchTerm}&quot;</span>
            </div>
          )}

          {data?.groups?.map((group) => {
            if (group.items.length === 0) return null;
            return (
              <div key={group.type} className="space-y-1.5">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const itemGlobalIndex = allItems.findIndex(
                      (i) => i.type === item.type && i.id === item.id
                    );
                    const isSelected = itemGlobalIndex === selectedIndex;

                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        type="button"
                        onClick={() => handleSelectItem(item)}
                        onMouseEnter={() => setSelectedIndex(itemGlobalIndex)}
                        role="option"
                        aria-selected={isSelected}
                        className={cn(
                          "w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-colors cursor-pointer",
                          isSelected
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : "hover:bg-secondary/60 text-foreground border border-transparent"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={cn(
                              "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                              isSelected ? "bg-primary/20" : "bg-secondary"
                            )}
                          >
                            {TYPE_ICONS[item.type] || <Search className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate text-foreground">
                              {item.title}
                            </p>
                            {item.subtitle && (
                              <p className="text-xs text-muted-foreground truncate">
                                {item.subtitle}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          {item.badge && (
                            <Badge variant="secondary" className="text-[10px] py-0 px-2 font-normal">
                              {item.badge}
                            </Badge>
                          )}
                          {isSelected && (
                            <CornerDownLeft className="h-3.5 w-3.5 text-primary opacity-70" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Keyboard hints footer */}
        <div className="p-3 border-t border-border bg-secondary/30 flex items-center justify-between text-xs text-muted-foreground px-4">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <ArrowUpDown className="h-3 w-3" />
              Navegar
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">
                Enter
              </kbd>
              Abrir
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border text-[10px] font-mono">
                Esc
              </kbd>
              Fechar
            </span>
          </div>
          {allItems.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {allItems.length} {allItems.length === 1 ? "resultado" : "resultados"}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
