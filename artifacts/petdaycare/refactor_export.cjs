const fs = require('fs');

const path = './src/components/ui/advanced-data-table.tsx';
let content = fs.readFileSync(path, 'utf8');

// Add imports
if (!content.includes('import jsPDF')) {
    content = content.replace(
        'import { ArrowUpDown, ChevronDown, Download, FileText, FileSpreadsheet, Printer } from "lucide-react"',
        `import { ArrowUpDown, ChevronDown, Download, FileText, FileSpreadsheet, Printer } from "lucide-react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"`
    );
}

// Replace exportCSV and add exportPDF / exportXLSX
const exportCSVStart = `  const exportCSV = () => {`;
const printTableEnd = `  const printTable = () => {
    window.print()
  }`;

const startIdx = content.indexOf(exportCSVStart);
const endIdx = content.indexOf(printTableEnd, startIdx);

if (startIdx !== -1 && endIdx !== -1) {
    const newExports = `
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
      ...data.map(row => row.map(val => \`"\${val.replace(/"/g, '""')}"\`).join(","))
    ].join("\\n")

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    link.setAttribute("href", url)
    link.setAttribute("download", \`\${fileName}.csv\`)
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
    doc.save(\`\${fileName}.pdf\`)
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
    XLSX.writeFile(wb, \`\${fileName}.xlsx\`)
  }

`;
    content = content.substring(0, startIdx) + newExports + content.substring(endIdx);
}

// Replace dropdown items
const dropdownContent = `<DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportCSV}>
                <FileText className="mr-2 h-4 w-4" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={printTable}>
                <Printer className="mr-2 h-4 w-4" /> Imprimir
              </DropdownMenuItem>
            </DropdownMenuContent>`;

const newDropdownContent = `<DropdownMenuContent align="end">
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
            </DropdownMenuContent>`;

content = content.replace(dropdownContent, newDropdownContent);

fs.writeFileSync(path, content, 'utf8');
console.log("AdvancedDataTable exported successfully!");
