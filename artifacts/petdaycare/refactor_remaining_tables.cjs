const fs = require('fs');
const path = './src/pages/financial/index.tsx';
let content = fs.readFileSync(path, 'utf8');

// Function to replace a table with AdvancedDataTable
function refactorTab(tabName, newColumnsCode, newReturnCode) {
    const startMarker = \`function \${tabName}({ crecheId }: { crecheId: number }) {\`;
    const returnMarker = \`return (\`;

    const blockStart = content.indexOf(startMarker);
    if (blockStart === -1) return;
    
    const blockReturn = content.indexOf(returnMarker, blockStart);
    if (blockReturn === -1) return;
    
    // Find the end of the component by looking for the next function declaration
    let nextFuncMarker = '\\nfunction ';
    let nextFunc = content.indexOf(nextFuncMarker, blockReturn);
    if (nextFunc === -1) {
        nextFuncMarker = '\\nexport default function ';
        nextFunc = content.indexOf(nextFuncMarker, blockReturn);
    }
    
    if (nextFunc !== -1) {
       let tabStart = content.substring(blockStart, blockReturn);
       const beforeStr = content.substring(0, blockStart);
       const afterStr = content.substring(nextFunc);
       
       content = beforeStr + tabStart + newColumnsCode + "\\n  " + newReturnCode + '\\n' + afterStr;
       console.log(\`\${tabName} patched!\`);
    }
}

// 1. OrdersTab
const ordersColumns = \`
  const columns = React.useMemo(() => [
    { accessorKey: "id", header: "Pedido #", cell: (info: any) => <span className="font-medium text-white">#{info.getValue()}</span> },
    { accessorKey: "tutorName", header: "Tutor", cell: (info: any) => info.getValue() },
    { accessorKey: "createdAt", header: "Data", cell: (info: any) => format(new Date(info.getValue()), "dd/MM/yyyy HH:mm", { locale: ptBR }) },
    { accessorKey: "totalAmount", header: "Valor Total", cell: (info: any) => <span className="text-emerald-400 font-medium">{formatBRL(info.getValue())}</span> },
    { accessorKey: "status", header: "Status", cell: (info: any) => {
        const status = info.getValue();
        switch (status) {
          case 'pending': return <Badge variant="default" className="bg-white/10 text-white">Pendente</Badge>;
          case 'paid': return <Badge variant="default" className="bg-emerald-500/10 text-emerald-500">Pago</Badge>;
          case 'delivered': return <Badge variant="default" className="bg-blue-500/10 text-blue-500">Entregue</Badge>;
          case 'cancelled': return <Badge variant="destructive">Cancelado</Badge>;
          default: return <Badge variant="outline">{status}</Badge>;
        }
    } },
    {
      id: "actions",
      header: () => <div className="text-right">Ações</div>,
      cell: ({ row }: any) => {
        const order = row.original;
        return (
          <div className="flex justify-end gap-2">
            {order.status === 'pending' && (
               <Button size="sm" variant="default" className="bg-emerald-500 hover:bg-emerald-600" onClick={() => handleUpdateStatus(order.id, 'paid')}>Marcar Pago</Button>
            )}
            {order.status === 'paid' && (
               <Button size="sm" variant="default" className="bg-blue-500 hover:bg-blue-600" onClick={() => handleUpdateStatus(order.id, 'delivered')}>Marcar Entregue</Button>
            )}
            {(order.status === 'pending' || order.status === 'paid') && (
               <Button size="sm" variant="destructive" onClick={() => handleUpdateStatus(order.id, 'cancelled')}>Cancelar</Button>
            )}
          </div>
        );
      }
    }
  ], []);
\`;

const ordersReturn = \`return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
          <h3 className="font-medium text-white">Pedidos em Loja</h3>
        </div>
        <div className="p-4">
          <AdvancedDataTable 
            columns={columns} 
            data={ordersData?.data || []} 
            searchKey="tutorName" 
            searchPlaceholder="Buscar por tutor..." 
            fileName="Pedidos_Loja" 
          />
        </div>
      </CardContent>
    </Card>
  );\`;

refactorTab('OrdersTab', ordersColumns, ordersReturn);

// 2. ReceiptsTab
const receiptsColumns = \`
  const columns = React.useMemo(() => [
    { accessorKey: "id", header: "Fatura", cell: (info: any) => <span className="font-medium text-white">#{info.getValue()}</span> },
    { accessorKey: "tutorName", header: "Tutor", cell: (info: any) => info.getValue() || "Desconhecido" },
    { accessorKey: "createdAt", header: "Data Envio", cell: (info: any) => format(new Date(info.getValue()), "dd/MM/yyyy HH:mm", { locale: ptBR }) },
    { accessorKey: "amount", header: "Valor Original", cell: (info: any) => <span className="text-white font-medium">{formatBRL(info.getValue())}</span> },
    {
      id: "actions",
      header: () => <div className="text-right">Ações</div>,
      cell: ({ row }: any) => {
        const inv = row.original;
        return (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" className="text-blue-400 border-blue-400/20 hover:bg-blue-400/10" onClick={() => handleViewReceipt(inv.id)}>
              Visualizar Anexo
            </Button>
            <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white" onClick={() => handleApproveReceipt(inv.id)} disabled={approveMutation.isPending}>
              Aprovar Recebimento
            </Button>
          </div>
        );
      }
    }
  ], [approveMutation.isPending]);
\`;

const receiptsReturn = \`return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
          <h3 className="font-medium text-white">Comprovantes em Análise</h3>
        </div>
        <div className="p-4">
          <AdvancedDataTable 
            columns={columns} 
            data={pendingReceipts} 
            searchKey="tutorName" 
            searchPlaceholder="Buscar por tutor..." 
            fileName="Comprovantes" 
          />
        </div>
      </CardContent>
    </Card>
  );\`;

refactorTab('ReceiptsTab', receiptsColumns, receiptsReturn);

// 3. AuditTab
const auditColumns = \`
  const columns = React.useMemo(() => [
    { accessorKey: "createdAt", header: "Data/Hora", cell: (info: any) => format(new Date(info.getValue()), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }) },
    { accessorKey: "userName", header: "Usuário", cell: (info: any) => <span className="font-medium text-white">{info.getValue()}</span> },
    { accessorKey: "action", header: "Ação", cell: (info: any) => info.getValue() },
    { accessorKey: "entityType", header: "Entidade", cell: (info: any) => info.getValue() },
    { accessorKey: "details", header: "Detalhes", cell: (info: any) => <span className="text-muted-foreground truncate max-w-[200px] block">{info.getValue()}</span> }
  ], []);
\`;

const auditReturn = \`return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-white/5 p-4 rounded-xl border border-white/10">
        <div>
          <h3 className="font-medium text-white">Trilha de Auditoria (Audit Log)</h3>
          <p className="text-sm text-muted-foreground">Registre operações críticas, cancelamentos e estornos de segurança.</p>
        </div>
        <Button 
          variant={creche?.auditEnabled ? "destructive" : "default"} 
          onClick={handleToggleAudit}
          disabled={updateSettings.isPending}
          className={!creche?.auditEnabled ? "bg-emerald-500 hover:bg-emerald-600" : ""}
        >
          {creche?.auditEnabled ? "Desativar Log Geral" : "Ativar Modo Paranoico"}
        </Button>
      </div>
      
      <Card>
        <CardContent className="p-0">
          <div className="p-4">
            <AdvancedDataTable 
              columns={columns} 
              data={logs || []} 
              searchKey="userName" 
              searchPlaceholder="Buscar por usuário..." 
              fileName="Auditoria" 
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );\`;

refactorTab('AuditTab', auditColumns, auditReturn);

fs.writeFileSync(path, content, 'utf8');
