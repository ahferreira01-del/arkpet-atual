import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { useDashboardCashFlow, useDashboardDre } from "@/hooks/use-financial";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { formatCentsToBRL } from "@/lib/money";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export function CashFlowTab({ crecheId }: { crecheId: number }) {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const { toast } = useToast();

  const handleDateChange = (type: "start" | "end", val: string) => {
    const s = type === "start" ? new Date(val) : new Date(startDate);
    const e = type === "end" ? new Date(val) : new Date(endDate);
    if (e.getTime() - s.getTime() > 366 * 24 * 60 * 60 * 1000) {
      toast({ title: "Erro", description: "O intervalo máximo é de 1 ano.", variant: "destructive" });
      return;
    }
    if (type === "start") setStartDate(val);
    else setEndDate(val);
  };

  const { data: cashFlow, isLoading } = useDashboardCashFlow(crecheId, startDate, endDate);
  const { data: dre } = useDashboardDre(crecheId, startDate, endDate);


  const totalIncome = Array.isArray(cashFlow) ? cashFlow.filter((c: any) => c.type === 'income').reduce((sum: number, c: any) => sum + Number(c.total), 0) : 0;
  const totalExpenses = Array.isArray(cashFlow) ? cashFlow.filter((c: any) => c.type === 'expense').reduce((sum: number, c: any) => sum + Number(c.total), 0) : 0;

  const chartDataMap = new Map<string, { date: string; Entradas: number; Saídas: number }>();
  if (Array.isArray(cashFlow)) {
    cashFlow.forEach((c: any) => {
      const dateStr = format(new Date(c.date), "dd/MM");
      if (!chartDataMap.has(dateStr)) {
        chartDataMap.set(dateStr, { date: dateStr, Entradas: 0, Saídas: 0 });
      }
      const existing = chartDataMap.get(dateStr)!;
      if (c.type === 'income') existing.Entradas += Number(c.total);
      if (c.type === 'expense') existing.Saídas += Number(c.total);
    });
  }
  const chartData = Array.from(chartDataMap.values());

  if (isLoading) return <div className="text-center p-8 text-muted-foreground">Carregando fluxo de caixa...</div>;
  return (
    <div className="space-y-6">
        <DateFilterPopover
          start={startDate}
          end={endDate}
          onChangeStart={(val) => handleDateChange("start", val)}
          onChangeEnd={(val) => handleDateChange("end", val)}
        />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-success mb-2">Entradas</h3>
            <p className="text-3xl font-display font-bold text-foreground">
              {formatCentsToBRL(totalIncome)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-destructive mb-2">Saídas</h3>
            <p className="text-3xl font-display font-bold text-foreground">
              {formatCentsToBRL(totalExpenses)}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <h3 className="text-sm font-medium text-primary mb-2">Saldo Líquido</h3>
            <p className="text-3xl font-display font-bold text-foreground">
              {formatCentsToBRL(totalIncome - totalExpenses)}
            </p>
          </CardContent>
        </Card>
      </div>

      {chartData.length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <h3 className="text-lg font-display font-semibold mb-6 text-foreground">Evolução Diária</h3>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => formatCentsToBRL(value)} />
                  <RechartsTooltip
                    cursor={{ fill: 'hsl(var(--muted))' }}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))', borderRadius: '8px' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar dataKey="Entradas" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} maxBarSize={40} />
                  <Bar dataKey="Saídas" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}


    </div>
  );
}
