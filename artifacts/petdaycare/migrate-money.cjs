const fs = require('fs');
const path = require('path');

const filesToUpdate = [
  "src/pages/financial/index.tsx",
  "src/pages/financial/dashboards.tsx",
  "src/pages/tutor/financial.tsx",
  "src/pages/tutor/store.tsx",
  "src/pages/billing/index.tsx",
  "src/pages/thermal-receipt.tsx",
  "src/pages/pets/components/overview-tab.tsx",
  "src/components/modals/ThermalReceiptModal.tsx",
  "src/components/financial/pos-sale-modal.tsx",
  "src/components/financial/smart-indicators.tsx",
  "src/components/financial/executive-kpi-card.tsx"
];

filesToUpdate.forEach(file => {
  const fullPath = path.join(__dirname, file);
  if (!fs.existsSync(fullPath)) return;
  
  let content = fs.readFileSync(fullPath, 'utf8');
  let original = content;

  // Add import if not present
  if (!content.includes('formatCentsToBRL')) {
    // Find last import
    const importRegex = /import .* from ['"].*['"];?\n/g;
    let lastMatch;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      lastMatch = match;
    }
    if (lastMatch) {
      const insertPos = lastMatch.index + lastMatch[0].length;
      content = content.slice(0, insertPos) + 'import { formatCentsToBRL } from "@/lib/money";\n' + content.slice(insertPos);
    } else {
      content = 'import { formatCentsToBRL } from "@/lib/money";\n' + content;
    }
  }

  // Remove function formatBRL(value: number) { ... }
  content = content.replace(/function formatBRL\([\s\S]*?\n\}\n/, '');
  // Remove const fmtBRL = (v: any) => ...
  content = content.replace(/const fmtBRL = \([\s\S]*?;\n/, '');
  // Replace fmtBRL with formatCentsToBRL
  content = content.replace(/fmtBRL/g, 'formatCentsToBRL');
  // Replace formatBRL with formatCentsToBRL
  content = content.replace(/formatBRL/g, 'formatCentsToBRL');

  // Replace inline (value / 100).toLocaleString(...)
  // e.g. (Number(consumable.chargedPrice) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  // Actually, many places use Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val / 100)
  // Or (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  
  content = content.replace(/\(new Intl\.NumberFormat\([^)]+\)\.format\(([^/]+)\s*\/\s*100\)\)/g, 'formatCentsToBRL($1)');
  content = content.replace(/new Intl\.NumberFormat\([^)]+\)\.format\(([^/]+)\s*\/\s*100\)/g, 'formatCentsToBRL($1)');
  content = content.replace(/\(([^/]+)\s*\/\s*100\)\.toLocaleString\([^)]+\)/g, 'formatCentsToBRL($1)');

  if (content !== original) {
    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`Updated ${file}`);
  }
});
