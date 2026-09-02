import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { PageHeader } from "@/components/layout/page-header";
import { BarChart3, Receipt, FileText, PackageOpen, ShoppingBag, CircleDollarSign, ShoppingCart, ShieldAlert, Camera, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { useSearch, useLocation } from "wouter";
import { useState } from "react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { POSSaleModal } from "@/components/financial/pos-sale-modal";
import { ReportsCentralTab } from "./dashboards";
import { CashFlowTab } from "./tabs/cash-flow-tab";
import { AuditTab } from "./tabs/audit-tab";
import { ReceiptsTab } from "./tabs/receipts-tab";
import { DefaultersTab } from "./tabs/defaulters-tab";
import { OrdersTab } from "./tabs/orders-tab";
import { PayablesTab } from "./tabs/payables-tab";
import { ReceivablesTab } from "./tabs/receivables-tab";
import { CatalogueTab } from "./tabs/catalogue-tab";
import { CommandPalette } from "@/components/financial/command-palette";
import { FinancialProvider, useFinancialContext } from "@/components/financial/financial-context";

function FinancialDashboardContent() {
  const { user } = useAuth();
  const crecheId = user?.crecheId as number;
  const searchStr = useSearch();
  const urlParams = new URLSearchParams(searchStr);
  const activeTab = urlParams.get("tab") || "cashflow";
  const [location, navigate] = useLocation();
  const [isPosModalOpen, setIsPosModalOpen] = useState(false);
  const { startDate, endDate, setStartDate, setEndDate } = useFinancialContext();

  const handleTabChange = (value: string) => {
    navigate(`${location}?tab=${value}`, { replace: true });
  };

  const TAB_GROUPS = [
    {
      id: "operacional",
      label: "Operacional",
      items: [
        { id: "cashflow", label: "Movimentações", icon: <BarChart3 className="h-4 w-4" />, content: <CashFlowTab crecheId={crecheId} /> },
        { id: "receivables", label: "A Receber", icon: <Receipt className="h-4 w-4" />, content: <ReceivablesTab crecheId={crecheId} /> },
        { id: "defaulters", label: "Inadimplência", icon: <FileText className="h-4 w-4 text-red-400" />, content: <DefaultersTab crecheId={crecheId} /> },
        { id: "payables", label: "A Pagar", icon: <FileText className="h-4 w-4" />, content: <PayablesTab crecheId={crecheId} /> },
        { id: "reports", label: "Central de Relatórios", icon: <FileText className="h-4 w-4" />, content: <ReportsCentralTab crecheId={crecheId} /> }
      ]
    },
    {
      id: "gestao",
      label: "Gestão e Controles",
      items: [
        { id: "catalogue", label: "Catálogo", icon: <PackageOpen className="h-4 w-4" />, content: <CatalogueTab crecheId={crecheId} /> },
        { id: "orders", label: "Pedidos (Loja)", icon: <ShoppingBag className="h-4 w-4 text-emerald-400" />, content: <OrdersTab crecheId={crecheId} /> },
        { id: "receipts", label: "Comprovantes", icon: <Camera className="h-4 w-4" />, content: <ReceiptsTab crecheId={crecheId} /> },
        { id: "audit", label: "Auditoria", icon: <ShieldAlert className="h-4 w-4 text-orange-400" />, content: <AuditTab crecheId={crecheId} /> }
      ]
    }
  ];

  const activeTabId = urlParams.get('tab') || 'reports';

  let activeContent: React.ReactNode = null;
  let activeGroupId: string | null = null;

  TAB_GROUPS.forEach(g => {
    g.items.forEach(i => {
      if (i.id === activeTabId) {
        activeContent = i.content;
        activeGroupId = g.id;
      }
    });
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col lg:flex-row justify-between lg:items-center items-start gap-4">
        <PageHeader
          title="Financeiro"
          description="Gestão de faturamento, despesas e fluxo de caixa."
          icon={CircleDollarSign}
        />
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:space-x-4 w-full lg:w-auto">
          <div className="flex flex-row items-center gap-2 w-full sm:w-auto">
            <DateFilterPopover
              start={startDate}
              end={endDate}
              onChangeStart={setStartDate}
              onChangeEnd={setEndDate}
            />
            <div className="flex-1 min-w-0">
              <CommandPalette crecheId={crecheId} />
            </div>
          </div>
          <Button onClick={() => setIsPosModalOpen(true)} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold shadow-sm transition-all hover:shadow-md w-full sm:w-auto">
            <ShoppingCart className="mr-2 h-4 w-4 shrink-0" /> Venda Balcão (PDV)
          </Button>
        </div>
      </div>

      {isPosModalOpen && (
        <POSSaleModal isOpen={true} onClose={() => setIsPosModalOpen(false)} crecheId={crecheId} />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-4 border-b border-white/10 pb-4">
        {TAB_GROUPS.map(group => {
          const isActiveGroup = activeGroupId === group.id;
          const activeItemInGroup = group.items.find(i => i.id === activeTabId);

          return (
            <DropdownMenu key={group.id}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={isActiveGroup ? "outline" : "ghost"}
                  className={`w-full sm:w-auto justify-between sm:justify-center ${isActiveGroup ? 'bg-primary/20 text-primary hover:bg-primary/30 border-primary/50' : 'text-muted-foreground'}`}
                >
                  <span className="font-semibold">{group.label}</span>
                  {isActiveGroup && activeItemInGroup && (
                    <>
                      <span className="mx-2 opacity-50">-</span>
                      <span className="font-normal">{activeItemInGroup.label}</span>
                    </>
                  )}
                  <ChevronDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-zinc-950 border-white/10">
                {group.items.map(item => (
                  <DropdownMenuItem
                    key={item.id}
                    onClick={() => handleTabChange(item.id)}
                    className={`cursor-pointer ${item.id === activeTabId ? 'bg-white/10 text-white' : 'text-muted-foreground hover:text-white'}`}
                  >
                    {item.icon}
                    <span className="ml-2">{item.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>

      <div className="pt-2 relative flex-1">
        {activeContent}
      </div>
    </div>
  );
}


export default function FinancialDashboard() {
  return (
    <FinancialProvider>
      <FinancialDashboardContent />
    </FinancialProvider>
  );
}
