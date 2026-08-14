const fs = require('fs');
const path = require('path');
const searchStr = 'new Date().toISOString().split("T")[0]';

function processFile(filePath, relativeToLib) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(searchStr)) {
    content = content.replace(/new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]/g, 'getBusinessDate()');
    
    // Add import if not present
    if (!content.includes('getBusinessDate')) {
      const importStmt = 'import { getBusinessDate } from "' + relativeToLib + '";\n';
      
      const lastImportIndex = content.lastIndexOf('import ');
      if (lastImportIndex !== -1) {
        const endOfLine = content.indexOf('\n', lastImportIndex);
        content = content.slice(0, endOfLine + 1) + importStmt + content.slice(endOfLine + 1);
      } else {
        content = importStmt + content;
      }
    }
    fs.writeFileSync(filePath, content);
    console.log('Updated: ' + filePath);
  }
}

processFile('artifacts/api-server/src/routes/financial/expense.routes.ts', '../../lib/date.js');
processFile('artifacts/api-server/src/routes/financial/transaction.routes.ts', '../../lib/date.js');
processFile('artifacts/api-server/src/routes/bookings.ts', '../lib/date.js');
processFile('artifacts/api-server/src/routes/creches.ts', '../lib/date.js');
processFile('artifacts/api-server/src/routes/financial-analytics.ts', '../lib/date.js');
processFile('artifacts/api-server/src/routes/financial-reports.ts', '../lib/date.js');
processFile('artifacts/api-server/src/routes/medical.ts', '../lib/date.js');
processFile('artifacts/api-server/src/services/billing.ts', '../lib/date.js');
processFile('artifacts/api-server/src/services/credits.ts', '../lib/date.js');
processFile('artifacts/api-server/src/services/pos.ts', '../lib/date.js');
processFile('artifacts/api-server/src/services/wallet.ts', '../lib/date.js');
