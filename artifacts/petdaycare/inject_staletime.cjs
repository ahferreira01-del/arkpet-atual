const fs = require('fs');
const path = './src/hooks/use-financial.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/useQuery\(\{/g, 'useQuery({\n    staleTime: 5 * 60 * 1000, // 5 minutos de cache para evitar refetching');

fs.writeFileSync(path, content, 'utf8');
console.log('staleTime injected!');
