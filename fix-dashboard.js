const fs = require('fs');
const path = require('path');
const file = 'artifacts/petdaycare/src/pages/dashboard.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  'import { useTutorInvoices } from "@/hooks/use-financial";',
  'import { useUpcomingInvoices } from "@/hooks/use-financial";'
);

content = content.replace(
  'const { data: invoices, isLoading: invoicesLoading } = useTutorInvoices(crecheId, user.id);',
  'const { data: invoices, isLoading: invoicesLoading } = useUpcomingInvoices(crecheId, user.id);'
);

fs.writeFileSync(file, content);
console.log('Fixed dashboard.tsx');
