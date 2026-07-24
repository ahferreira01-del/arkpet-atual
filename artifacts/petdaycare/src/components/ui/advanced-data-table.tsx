import * as React from "react"
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowUpDown, ChevronDown, Download, FileText, FileSpreadsheet, Printer } from "lucide-react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"

import { Button } from "./button"
import { Input } from "./input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table"

interface AdvancedDataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchKey?: string
  searchPlaceholder?: string
  fileName?: string
}

export function AdvancedDataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "Pesquisar...",
  fileName = "Relatorio"
}: AdvancedDataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})

  // Load from local storage (simplified for demo)
  React.useEffect(() => {
    const saved = localStorage.getItem(`table_vis_${fileName}`);
    if (saved) {
      try { setColumnVisibility(JSON.parse(saved)) } catch(e){}
    }
  }, [fileName])

  React.useEffect(() => {
    if (Object.keys(columnVisibility).length > 0) {
      localStorage.setItem(`table_vis_${fileName}`, JSON.stringify(columnVisibility))
    }
  }, [columnVisibility, fileName])

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
    initialState: {
      pagination: {
        pageSize: 25,
      }
    }
  })


  const getExportData = () => {
    const rows = table.getFilteredRowModel().rows
    const cols = table.getVisibleFlatColumns().filter(c => c.id !== 'actions' && c.id !== 'select')
    const headers = cols.map(c => typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id)
    
    const data = rows.map(r => {
      return cols.map(c => {
         let val = r.getValue(c.id)
         if (val === null || val === undefined) return ""
         return String(val)
      })
    })
    
    return { headers, data }
  }

  const exportCSV = () => {
    const { headers, data } = getExportData()
    const csvContent = [
      headers.join(","),
      ...data.map(row => row.map(val => `"${val.replace(/"/g, '""')}"`).join(","))
    ].join("\n")

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    link.setAttribute("href", url)
    link.setAttribute("download", `${fileName}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const exportPDF = () => {
    const doc = new jsPDF()
    const { headers, data } = getExportData()
    
    autoTable(doc, {
      head: [headers],
      body: data,
    })
    doc.save(`${fileName}.pdf`)
  }

  const exportXLSX = () => {
    const { headers, data } = getExportData()
    
    // Convert to array of objects for XLSX
    const sheetData = data.map(row => {
      const obj: any = {}
      headers.forEach((h, i) => { obj[h] = row[i] })
      return obj
    })
    
    const ws = XLSX.utils.json_to_sheet(sheetData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Relatorio")
    XLSX.writeFile(wb, `${fileName}.xlsx`)
  }

  const printTable = () => {
    window.print()
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between py-2">
        {searchKey && (
          <Input
            placeholder={searchPlaceholder}
            value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ""}
            onChange={(event) =>
              table.getColumn(searchKey)?.setFilterValue(event.target.value)
            }
            className="max-w-sm"
          />
        )}
        <div className="flex items-center space-x-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="ml-auto">
                <Download className="mr-2 h-4 w-4" /> Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportCSV}>
                <FileText className="mr-2 h-4 w-4" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportXLSX}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Excel (XLSX)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportPDF}>
                <FileText className="mr-2 h-4 w-4 text-red-500" /> PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={printTable}>
                <Printer className="mr-2 h-4 w-4" /> Imprimir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Colunas <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {table
                .getAllColumns()
                .filter((column) => column.getCanHide())
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
                    </DropdownMenuCheckboxItem>
                  )
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="rounded-md border bg-card text-card-foreground shadow-sm overflow-hidden hidden md:block">
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id} className="font-semibold text-muted-foreground">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="transition-colors hover:bg-muted/50"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  Nenhum resultado encontrado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="md:hidden grid grid-cols-1 gap-4">
        {table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => (
            <div key={row.id} className="bg-card border border-white/5 rounded-xl p-4 flex flex-col gap-3 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary/20" />
              {row.getVisibleCells().map((cell) => {
                if (cell.column.id === 'actions') {
                  return (
                    <div key={cell.id} className="pt-3 mt-1 border-t border-white/5 flex justify-end">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  )
                }
                return (
                  <div key={cell.id} className="flex justify-between items-center gap-4">
                    <span className="text-xs text-muted-foreground font-medium shrink-0">
                      {typeof cell.column.columnDef.header === 'string' ? cell.column.columnDef.header : cell.column.id}
                    </span>
                    <div className="text-sm font-medium text-right break-words overflow-hidden">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        ) : (
          <div className="text-center p-8 text-muted-foreground bg-card rounded-xl border border-white/5">
            Nenhum resultado encontrado.
          </div>
        )}
      </div>
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-4">
        <div className="w-full md:flex-1 text-sm text-muted-foreground text-center md:text-left">
          {table.getFilteredSelectedRowModel().rows.length} de{" "}
          {table.getFilteredRowModel().rows.length} linha(s) selecionada(s).
        </div>
        <div className="flex items-center space-x-2 w-full md:w-auto justify-between md:justify-end">
          <select 
            className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-foreground"
            value={table.getState().pagination.pageSize}
            onChange={e => table.setPageSize(Number(e.target.value))}
          >
            {[25, 50, 100, 250, 500].map(pageSize => (
              <option key={pageSize} value={pageSize} className="bg-zinc-900 text-foreground">
                Mostrar {pageSize}
              </option>
            ))}
          </select>
          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Próximo
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
