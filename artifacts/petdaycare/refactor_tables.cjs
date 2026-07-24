const fs = require('fs');

const path = './src/pages/financial/index.tsx';
let content = fs.readFileSync(path, 'utf8');

// --- Refactor PayablesTab ---
const payablesStartMarker = `function PayablesTab({ crecheId }: { crecheId: number }) {`;
const payablesReturnMarker = `return (
    <>
    <Card>`;

const blockStart = content.indexOf(payablesStartMarker);
const blockReturn = content.indexOf(payablesReturnMarker, blockStart);

if (blockStart !== -1 && blockReturn !== -1) {
    let tabStart = content.substring(blockStart, blockReturn);
    
    const newReturn = `
  const columns = React.useMemo(() => [
    { accessorKey: "description", header: "Descrição", cell: (info: any) => info.getValue() },
    { accessorKey: "category", header: "Categoria", cell: (info: any) => <span className="capitalize">{info.getValue()}</span> },
    { accessorKey: "dueDate", header: "Data", cell: (info: any) => {
        const d = info.getValue() || info.row.original.date || new Date();
        return format(new Date(d), "dd/MM/yyyy", { locale: ptBR });
    } },
    { accessorKey: "amount", header: "Valor", cell: (info: any) => <span className="text-red-400 font-medium">-{formatBRL(info.getValue())}</span> },
    { accessorKey: "isPaid", header: "Status", cell: (info: any) => {
        return info.getValue() 
          ? <Badge variant="default" className="bg-emerald-500/10 text-emerald-500">Pago</Badge> 
          : <Badge variant="default" className="bg-white/10 text-white">Pendente</Badge>;
    } },
    {
      id: "actions",
      header: () => <div className="text-right">Ação</div>,
      cell: ({ row }: any) => {
        const exp = row.original;
        return (
          <div className="flex justify-end space-x-2 gap-1">
            {!exp.isPaid && (
              <Button size="sm" onClick={() => handlePay(exp.id)} isLoading={payMutation.isPending} className="bg-emerald-500 hover:bg-emerald-600">
                Pagar
              </Button>
            )}
            <Button size="sm" variant="default" className="bg-white/10 text-white" onClick={() => openEditModal(exp)}>
              Editar
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleDelete(exp.id)} isLoading={deleteMutation.isPending}>
              Excluir
            </Button>
          </div>
        );
      }
    }
  ], [payMutation.isPending, deleteMutation.isPending]);

  return (
    <>
    <Card>
      <CardContent className="p-0">
        <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
          <h3 className="font-medium text-white">Despesas Registradas</h3>
          <Button size="sm" onClick={() => {
            setEditingId(null);
            setForm({ description: "", category: "operacional", amount: "", dueDate: "" });
            setModalOpen(true);
          }}>
            <Plus className="mr-2 h-4 w-4" /> Nova Despesa
          </Button>
        </div>
        <div className="p-4">
          <AdvancedDataTable 
            columns={columns} 
            data={expenses || []} 
            searchKey="description" 
            searchPlaceholder="Buscar despesa..." 
            fileName="Despesas" 
          />
        </div>
      </CardContent>
    </Card>
`;
    // find end of PayablesTab block (the modal)
    // we just replace up to {modalOpen && ...
    const modalMarker = `{modalOpen && (`;
    const nextFunc = content.indexOf(modalMarker, blockReturn);
    
    if (nextFunc !== -1) {
       const beforeStr = content.substring(0, blockStart);
       const afterStr = content.substring(nextFunc);
       content = beforeStr + tabStart + newReturn + afterStr;
       console.log("PayablesTab patched!");
    }
}

// --- Refactor DefaultersTab ---
const defStartMarker = `function DefaultersTab({ crecheId }: { crecheId: number }) {`;
const defReturnMarker = `return (
    <div className="space-y-6">`;

const dBlockStart = content.indexOf(defStartMarker);
const dBlockReturn = content.indexOf(defReturnMarker, dBlockStart);

if (dBlockStart !== -1 && dBlockReturn !== -1) {
    let tabStart = content.substring(dBlockStart, dBlockReturn);
    
    const newReturn = `
  const columns = React.useMemo(() => [
    { accessorKey: "tutorName", header: "Tutor", cell: (info: any) => <span className="font-medium text-white">{info.getValue() || "Desconhecido"}</span> },
    { accessorKey: "totalDue", header: "Total em Atraso", cell: (info: any) => <span className="font-bold text-red-400">{formatBRL(info.getValue())}</span> },
    { accessorKey: "oldestInvoiceDate", header: "Fatura Mais Antiga", cell: (info: any) => format(new Date(info.getValue()), "dd/MM/yyyy", { locale: ptBR }) },
    { accessorKey: "overdueInvoicesCount", header: "Qtd Faturas", cell: (info: any) => info.getValue() },
    {
      id: "actions",
      header: () => <div className="text-right">Ação</div>,
      cell: ({ row }: any) => {
        const tutor = row.original;
        const msg = encodeURIComponent(\`Olá \${tutor.tutorName}, notamos que há \${tutor.overdueInvoicesCount} fatura(s) em aberto no valor de \${formatBRL(tutor.totalDue)}. Poderia verificar?\`);
        return (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-400/20 hover:bg-emerald-400/10" onClick={() => window.open(\`https://wa.me/?text=\${msg}\`, '_blank')}>
              Cobrar via WhatsApp
            </Button>
          </div>
        );
      }
    }
  ], []);

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-red-500/10 to-transparent border-red-500/20">
        <CardContent className="p-6">
          <h3 className="text-sm font-medium text-red-400 mb-2">Total em Inadimplência</h3>
          <p className="text-3xl font-display font-bold text-white">
            {formatBRL(totalDefaulters)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
            <h3 className="font-medium text-white">Tutores Inadimplentes</h3>
          </div>
          <div className="p-4">
             <AdvancedDataTable 
               columns={columns} 
               data={defaultersData || []} 
               searchKey="tutorName" 
               searchPlaceholder="Buscar tutor inadimplente..." 
               fileName="Inadimplentes" 
             />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
`;

    // find end of DefaultersTab block
    const nextFunc = content.indexOf('function ReceiptsTab', dBlockReturn);
    
    if (nextFunc !== -1) {
       const beforeStr = content.substring(0, dBlockStart);
       const afterStr = content.substring(nextFunc);
       content = beforeStr + tabStart + newReturn + '\n\n' + afterStr;
       console.log("DefaultersTab patched!");
    }
}

fs.writeFileSync(path, content, 'utf8');
