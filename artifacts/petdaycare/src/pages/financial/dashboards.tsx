import React, { useState } from "react";
import { useFinancialReport } from "../../hooks/use-financial";
import { useFinancialContext } from "../../components/financial/financial-context";
import { AdvancedDataTable } from "../../components/ui/advanced-data-table";
import { Card, CardContent } from "../../components/ui/card";
import { formatCentsToBRL } from "@/lib/money";

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

  // Shared export formatter for cent-stored monetary values.
  
  const columnsMap: Record<string, any[]> = {
    "cash-flow": [
      { accessorKey: "date", header: "Data", cell: (info: any) => new Date(info.getValue()).toLocaleDateString('pt-BR') },
      { accessorKey: "description", header: "Descrição" },
      { accessorKey: "type", header: "Tipo" },
      { accessorKey: "amount", header: "Valor", meta: { exportValue: formatCentsToBRL }, cell: (info: any) => formatCentsToBRL(info.getValue()) },
    ],
    "accounts-receivable": [
      { accessorKey: "id", header: "Fatura" },
      { accessorKey: "tutorName", header: "Tutor" },
      { accessorKey: "issueDate", header: "Emissão", cell: (info: any) => new Date(info.getValue()).toLocaleDateString('pt-BR') },
      { accessorKey: "status", header: "Status" },
      { accessorKey: "amount", header: "Valor", meta: { exportValue: formatCentsToBRL }, cell: (info: any) => formatCentsToBRL(info.getValue()) },
    ],
    "accounts-payable": [
      { accessorKey: "dueDate", header: "Vencimento", cell: (info: any) => new Date(info.getValue()).toLocaleDateString('pt-BR') },
      { accessorKey: "description", header: "Descrição" },
      { accessorKey: "supplier", header: "Fornecedor" },
      { accessorKey: "status", header: "Status", cell: (info: any) => info.row.original.isPaid ? 'Pago' : 'Pendente' },
      { accessorKey: "amount", header: "Valor", meta: { exportValue: formatCentsToBRL }, cell: (info: any) => formatCentsToBRL(info.getValue()) },
    ],
    "products-sold": [
      { accessorKey: "date", header: "Data", cell: (info: any) => new Date(info.getValue()).toLocaleDateString('pt-BR') },
      { accessorKey: "productName", header: "Produto" },
      { accessorKey: "tutorName", header: "Tutor" },
      { accessorKey: "quantity", header: "Qtd" },
      { accessorKey: "unitPrice", header: "Preço", meta: { exportValue: formatCentsToBRL }, cell: (info: any) => formatCentsToBRL(info.getValue()) },
    ]
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardContent className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="w-full sm:w-auto flex-1 max-w-sm">
            <label className="text-sm font-medium text-muted-foreground mb-2 block">Tipo de Relatório</label>
            <select 
              value={reportType} 
              onChange={(e) => setReportType(e.target.value)}
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary text-foreground"
            >
              {reportOptions.map(opt => (
                <option key={opt.value} value={opt.value} className="bg-background text-foreground">{opt.label}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
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
