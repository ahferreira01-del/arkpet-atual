import React, { useState } from "react";
import { useDashboardKPIs, useDashboardCharts, useDashboardSales, useFinancialReport } from "../../hooks/use-financial";
import { useFinancialContext } from "../../components/financial/financial-context";
import { ExecutiveKpiCard } from "../../components/financial/executive-kpi-card";
import { AdvancedDataTable } from "../../components/ui/advanced-data-table";
import { DateFilterPopover } from "../../components/ui/date-filter-popover";
import { DollarSign, TrendingUp, TrendingDown, Wallet, Activity, CreditCard, ShoppingBag, Store, Users, Dog, PackageOpen, LayoutDashboard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

export function ExecutiveDashboardTab({ crecheId }: { crecheId: number }) {
  const { startDate, endDate } = useFinancialContext();

  const { data: kpis, isLoading } = useDashboardKPIs(crecheId, startDate, endDate);

  if (isLoading || !kpis) {
    return <div className="text-center p-8 text-muted-foreground">Carregando métricas executivas...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <ExecutiveKpiCard title="Receita Bruta" kpi={kpis.grossRevenue} icon={TrendingUp} />
        <ExecutiveKpiCard title="Receita Líquida" kpi={kpis.netRevenue} icon={DollarSign} />
        <ExecutiveKpiCard title="Despesas" kpi={kpis.expenses} icon={TrendingDown} inverseColors />
        <ExecutiveKpiCard title="Lucro Líquido" kpi={kpis.netProfit} icon={Wallet} />
        
        <ExecutiveKpiCard title="Margem de Lucro (%)" kpi={kpis.profitMargin} icon={Activity} formatAsCurrency={false} />
        <ExecutiveKpiCard title="Faturamento Previsto" kpi={kpis.forecastRevenue} icon={Activity} />
        <ExecutiveKpiCard title="Valor Recebido" kpi={kpis.receivedRevenue} icon={CreditCard} />
        <ExecutiveKpiCard title="Em Aberto (A Receber)" kpi={kpis.openAmount} icon={Wallet} />
        
        <ExecutiveKpiCard title="Inadimplência" kpi={kpis.defaultAmount} icon={TrendingDown} inverseColors />
        <ExecutiveKpiCard title="Ticket Médio" kpi={kpis.averageTicket} icon={ShoppingBag} />
        <ExecutiveKpiCard title="Rec. Média por Tutor" kpi={kpis.averageRevenuePerTutor} icon={Users} />
        <ExecutiveKpiCard title="Vendas Balcão (PDV)" kpi={kpis.posSales} icon={Store} formatAsCurrency={false} />
        
        <ExecutiveKpiCard title="Produtos Vendidos" kpi={kpis.productsSold} icon={PackageOpen} formatAsCurrency={false} />
        <ExecutiveKpiCard title="Serviços Prestados" kpi={kpis.servicesRendered} icon={Dog} formatAsCurrency={false} />
        <ExecutiveKpiCard title="Pedidos na Loja" kpi={kpis.storeOrders} icon={ShoppingBag} formatAsCurrency={false} />
      </div>
    </div>
  );
}

export function SalesDashboardTab({ crecheId }: { crecheId: number }) {
  const { startDate, endDate } = useFinancialContext();

  // Use the same KPIs for top level sales metrics, but we could add a new hook
  const { data: sales, isLoading } = useDashboardSales(crecheId, startDate, endDate);

  if (isLoading) {
    return <div className="text-center p-8 text-muted-foreground">Carregando BI de Vendas...</div>;
  }

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold flex items-center"><LayoutDashboard className="mr-2 h-5 w-5" /> Inteligência de Vendas</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Top Produtos Vendidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[]}>
                   <CartesianGrid strokeDasharray="3 3" />
                   <XAxis dataKey="name" />
                   <YAxis />
                   <Tooltip />
                   <Bar dataKey="total" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Serviços Vendidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[]}>
                   <CartesianGrid strokeDasharray="3 3" />
                   <XAxis dataKey="name" />
                   <YAxis />
                   <Tooltip />
                   <Bar dataKey="total" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export function ReportsCentralTab({ crecheId }: { crecheId: number }) {
  const { startDate, endDate } = useFinancialContext();
  const [reportType, setReportType] = useState("cash-flow");
  const { data, isLoading } = useFinancialReport(crecheId, reportType, startDate, endDate);

  const reportOptions = [
    { value: "cash-flow", label: "Fluxo de Caixa Detalhado" },
    { value: "accounts-receivable", label: "Contas a Receber" },
    { value: "accounts-payable", label: "Contas a Pagar" },
    { value: "products-sold", label: "Produtos Vendidos" },
  ];

  const columnsMap: Record<string, any[]> = {
    "cash-flow": [
      { accessorKey: "date", header: "Data", cell: (info: any) => new Date(info.getValue()).toLocaleDateString('pt-BR') },
      { accessorKey: "description", header: "Descrição" },
      { accessorKey: "type", header: "Tipo" },
      { accessorKey: "amount", header: "Valor", cell: (info: any) => (Number(info.getValue()) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
    ],
    "accounts-receivable": [
      { accessorKey: "id", header: "Fatura" },
      { accessorKey: "tutorName", header: "Tutor" },
      { accessorKey: "issueDate", header: "Emissão", cell: (info: any) => new Date(info.getValue()).toLocaleDateString('pt-BR') },
      { accessorKey: "status", header: "Status" },
      { accessorKey: "amount", header: "Valor", cell: (info: any) => (Number(info.getValue()) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
    ],
    "accounts-payable": [
      { accessorKey: "dueDate", header: "Vencimento", cell: (info: any) => new Date(info.getValue()).toLocaleDateString('pt-BR') },
      { accessorKey: "description", header: "Descrição" },
      { accessorKey: "supplier", header: "Fornecedor" },
      { accessorKey: "status", header: "Status", cell: (info: any) => info.row.original.isPaid ? 'Pago' : 'Pendente' },
      { accessorKey: "amount", header: "Valor", cell: (info: any) => (Number(info.getValue()) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
    ],
    "products-sold": [
      { accessorKey: "date", header: "Data", cell: (info: any) => new Date(info.getValue()).toLocaleDateString('pt-BR') },
      { accessorKey: "productName", header: "Produto" },
      { accessorKey: "tutorName", header: "Tutor" },
      { accessorKey: "quantity", header: "Qtd" },
      { accessorKey: "unitPrice", header: "Preço", cell: (info: any) => (Number(info.getValue()) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
    ]
  };

  return (
    <div className="space-y-6">
       <div className="flex justify-between items-center bg-zinc-900/50 p-4 rounded-lg border border-white/10">
        <div className="flex items-center space-x-4">
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-1 block">Tipo de Relatório</label>
            <select 
              value={reportType} 
              onChange={(e) => setReportType(e.target.value)}
              className="flex h-9 w-full rounded-md border border-white/10 bg-black/40 px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 min-w-[250px] text-white"
            >
              {reportOptions.map(opt => (
                <option key={opt.value} value={opt.value} className="bg-zinc-900 text-white">{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center p-8 text-muted-foreground">Gerando relatório...</div>
          ) : (
            <div className="p-4">
              <AdvancedDataTable 
                columns={columnsMap[reportType] || []} 
                data={data?.data || []} 
                fileName={`Relatorio_${reportType}_${startDate}_${endDate}`}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
