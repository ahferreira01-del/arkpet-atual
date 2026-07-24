const fs = require('fs');

const path = './src/pages/financial/index.tsx';
let content = fs.readFileSync(path, 'utf8');

// Replace ReceivablesTab body
// First, we need to locate ReceivablesTab up to `return (`
const startMarker = `function ReceivablesTab({ crecheId }: { crecheId: number }) {`;
const returnMarker = `return (
    <div className="space-y-4">`;
    
const blockStart = content.indexOf(startMarker);
const blockReturn = content.indexOf(returnMarker, blockStart);

if (blockStart !== -1 && blockReturn !== -1) {
    let tabStart = content.substring(blockStart, blockReturn);
    
    // add useFinancialContext hook
    tabStart = tabStart.replace(
        `const [startDateFilter, setStartDateFilter] = useState("");\n  const [endDateFilter, setEndDateFilter] = useState("");`,
        `const { startDate: startDateFilter, endDate: endDateFilter } = useFinancialContext();`
    );
    
    tabStart = tabStart.replace(
        `const [tutorDropdownOpen, setTutorDropdownOpen] = useState(false);\n  const tutorDropdownRef = useRef<HTMLDivElement>(null);`,
        `// tutor dropdown removed in favor of AdvancedDataTable global search`
    );

    // Build the new return statement and body
    const newReturn = `
  const columns = React.useMemo(() => [
    { accessorKey: "tutorName", header: "Tutor", cell: (info: any) => info.getValue() || "Desconhecido" },
    { accessorKey: "createdAt", header: "Emissão", cell: (info: any) => info.getValue() ? format(new Date(info.getValue()), "dd/MM/yyyy", { locale: ptBR }) : "—" },
    { accessorKey: "dueDate", header: "Vencimento", cell: (info: any) => {
        const val = info.getValue();
        const inv = info.row.original;
        const isOverdue = val && ['pending', 'overdue'].includes(inv.status) && new Date(val).getTime() < new Date().setHours(0,0,0,0);
        return <span className={isOverdue ? "text-red-400 font-medium" : ""}>{val ? format(new Date(val), "dd/MM/yyyy", { locale: ptBR }) : "—"}</span>;
    } },
    { accessorKey: "amount", header: "Valor", cell: (info: any) => formatBRL(info.getValue()) },
    { accessorKey: "status", header: "Status", cell: (info: any) => {
        const status = info.getValue();
        return (
          <Badge variant={status === "paid" ? "success" : status === "awaiting_confirmation" ? "default" : status === "refunded" ? "outline" : status === "void" ? "secondary" : status === "overdue" ? "destructive" : "secondary"}>
            {status === "paid" ? "Pago" : status === "awaiting_confirmation" ? "Em Análise" : status === "refunded" ? "Estornado" : status === "void" ? "Cancelado" : status === "overdue" ? "Atrasado" : "Pendente"}
          </Badge>
        );
    } },
    {
      id: "actions",
      header: () => <div className="text-right">Ações</div>,
      cell: ({ row }: any) => {
        const inv = row.original;
        return (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setDetailsModal({ open: true, invoiceId: inv.id })} className="text-muted-foreground hover:text-white hover:bg-white/10">
              Detalhes
            </Button>
            {inv.receiptPhotoPath && (
              <Button variant="ghost" size="sm" onClick={() => handleViewReceipt(inv.id)} className="text-blue-400 hover:text-blue-300 hover:bg-blue-400/10">
                Ver Comprovante
              </Button>
            )}
            {inv.status === "awaiting_confirmation" && (
              <Button variant="ghost" size="sm" onClick={() => handleApproveReceipt(inv.id)} disabled={approveReceiptMutation.isPending} className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10">
                Aprovar
              </Button>
            )}
            {inv.status === "paid" && (
              <Button variant="ghost" size="sm" onClick={() => handleRefund(inv.id)} disabled={refundMutation.isPending} className="text-red-400 hover:text-red-300 hover:bg-red-400/10">
                Estornar
              </Button>
            )}
            {(inv.status === "pending" || inv.status === "overdue") && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setPayModal({ open: true, invoiceId: inv.id })} className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10">
                  Receber
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleVoid(inv.id)} disabled={voidMutation.isPending} className="text-muted-foreground hover:text-white hover:bg-white/10">
                  Cancelar
                </Button>
              </>
            )}
          </div>
        );
      }
    }
  ], [approveReceiptMutation.isPending, refundMutation.isPending, voidMutation.isPending]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <div className="p-4">
            <AdvancedDataTable 
              columns={columns} 
              data={invoiceList} 
              searchKey="tutorName" 
              searchPlaceholder="Buscar por tutor..." 
              fileName="A_Receber" 
            />
          </div>
        </CardContent>
      </Card>
      
      {payModal.open && (
        <Modal isOpen={true} onClose={() => setPayModal({ open: false, invoiceId: null })} title="Dar Baixa Manual">
          <div className="space-y-4">
            <div>
              <label className="text-sm">Método de Pagamento</label>
              <select 
                className="w-full bg-white/5 border border-white/10 rounded-md h-10 px-3 text-sm mt-1"
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value)}
              >
                <option value="pix" className="bg-zinc-900">Pix</option>
                <option value="cash" className="bg-zinc-900">Dinheiro</option>
                <option value="credit_card" className="bg-zinc-900">Cartão de Crédito/Débito (Maquininha)</option>
                <option value="bank_slip" className="bg-zinc-900">Boleto (Externo)</option>
              </select>
            </div>
            <Button onClick={handlePayManual} isLoading={payManualMutation.isPending} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white">
              Confirmar Recebimento
            </Button>
          </div>
        </Modal>
      )}

      <InvoiceERPView 
        crecheId={crecheId} 
        invoiceId={detailsModal.invoiceId} 
        open={detailsModal.open} 
        onClose={() => setDetailsModal({ open: false, invoiceId: null })}
        invoiceStatus={rawInvoiceList.find((i:any) => i.id === detailsModal.invoiceId)?.status}
        issueDate={rawInvoiceList.find((i:any) => i.id === detailsModal.invoiceId)?.createdAt}
        tutorName={rawInvoiceList.find((i:any) => i.id === detailsModal.invoiceId)?.tutorName}
      />
    </div>
  );
}`;

    // find end of ReceivablesTab block
    const nextFunc = content.indexOf('function PayablesTab', blockReturn);
    
    const beforeStr = content.substring(0, blockStart);
    const afterStr = content.substring(nextFunc);
    
    content = beforeStr + tabStart + newReturn + '\n\n' + afterStr;
    fs.writeFileSync(path, content, 'utf8');
    console.log("ReceivablesTab patched!");
}
