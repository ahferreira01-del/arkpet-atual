import React, { useState, useEffect } from "react";
import { Command } from "cmdk";
import { Search, Calculator, Receipt, User, Package, FileText, ArrowRight } from "lucide-react";
import { useFinancialSearch } from "../../hooks/use-financial";
import { Modal } from "../ui/modal";
import { useLocation } from "wouter";

interface CommandPaletteProps {
  crecheId: number;
}

export function CommandPalette({ crecheId }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data, isLoading } = useFinancialSearch(crecheId, query);
  const [, setLocation] = useLocation();

  // Toggle the menu when ⌘K is pressed
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const results = data?.results || [];

  const handleSelect = (result: any) => {
    setOpen(false);
    // Navigation logic based on result type
    if (result.type === 'invoice') {
      setLocation(`/creches/${crecheId}/financial?highlight=invoice-${result.id}`);
    } else if (result.type === 'tutor') {
      setLocation(`/creches/${crecheId}/tutors/${result.id}`);
    } else if (result.type === 'product' || result.type === 'service') {
      setLocation(`/creches/${crecheId}/catalogue?highlight=${result.id}`);
    }
  };

  return (
    <>
      <button 
        onClick={() => setOpen(true)}
        className="flex items-center text-sm px-3 py-1.5 border border-input rounded-md text-muted-foreground bg-background hover:bg-muted transition-colors w-64 justify-between"
      >
        <div className="flex items-center">
          <Search className="w-4 h-4 mr-2" />
          <span>Pesquisa Global...</span>
        </div>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      <Modal 
        isOpen={open} 
        onClose={() => setOpen(false)} 
        title="Spotlight Search" 
        className="max-w-2xl !p-0 overflow-hidden"
      >
        <Command 
          className="w-full h-full flex flex-col bg-card text-card-foreground"
          shouldFilter={false} // We filter on backend
        >
          <div className="flex items-center border-b border-border px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Command.Input 
              value={query}
              onValueChange={setQuery}
              placeholder="Busque por tutor, fatura, produto ou serviço..."
              className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          
          <Command.List className="max-h-[300px] overflow-y-auto p-2">
            {isLoading && <div className="p-4 text-sm text-center text-muted-foreground">Buscando...</div>}
            
            {!isLoading && results.length === 0 && query.length > 2 && (
              <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                Nenhum resultado encontrado.
              </Command.Empty>
            )}

            {!isLoading && results.length > 0 && (
              <Command.Group heading="Resultados">
                {results.map((res: any) => (
                  <Command.Item
                    key={`${res.type}-${res.id}`}
                    value={`${res.type}-${res.id}`}
                    onSelect={() => handleSelect(res)}
                    className="flex items-center px-2 py-3 rounded-md hover:bg-muted cursor-pointer text-sm"
                  >
                    {res.type === 'tutor' && <User className="mr-3 h-4 w-4 text-blue-500" />}
                    {res.type === 'invoice' && <Receipt className="mr-3 h-4 w-4 text-emerald-500" />}
                    {res.type === 'product' && <Package className="mr-3 h-4 w-4 text-amber-500" />}
                    {res.type === 'service' && <FileText className="mr-3 h-4 w-4 text-purple-500" />}
                    {res.type === 'transaction' && <Calculator className="mr-3 h-4 w-4 text-muted-foreground" />}
                    
                    <div className="flex flex-col flex-1">
                      <span className="font-medium text-foreground">{res.title}</span>
                      <span className="text-xs text-muted-foreground">{res.subtitle}</span>
                    </div>
                    
                    <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto opacity-50" />
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {query.length === 0 && (
              <Command.Group heading="Comandos Rápidos">
                <Command.Item className="flex items-center px-2 py-2 rounded-md hover:bg-muted cursor-pointer text-sm" onSelect={() => setLocation(`/creches/${crecheId}/financial?tab=reports`)}>
                  <FileText className="mr-3 h-4 w-4 text-muted-foreground" />
                  Ir para Relatórios
                </Command.Item>
                <Command.Item className="flex items-center px-2 py-2 rounded-md hover:bg-muted cursor-pointer text-sm" onSelect={() => setLocation(`/creches/${crecheId}/financial?tab=sales`)}>
                  <Calculator className="mr-3 h-4 w-4 text-muted-foreground" />
                  Ver Dashboard de Vendas
                </Command.Item>
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </Modal>
    </>
  );
}
