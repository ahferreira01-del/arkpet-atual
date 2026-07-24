const fs = require('fs');
const path = './src/hooks/use-financial.ts';
let content = fs.readFileSync(path, 'utf8');
const index = content.indexOf('export function useTutorSmartIndicators');
if (index !== -1) {
  content = content.substring(0, index);
}
content = content.replace(/\x00/g, '');

const newHooks = `
export function useTutorSmartIndicators(crecheId: number, tutorId: number | undefined) {
  return useQuery({
    queryKey: ['tutor-smart-indicators', crecheId, tutorId],
    queryFn: async () => {
      if (!tutorId) return null;
      const token = localStorage.getItem('auth_token');
      const res = await fetch(\`/api/creches/\${crecheId}/tutors/\${tutorId}/stats\`, {
        headers: { Authorization: \`Bearer \${token}\` }
      });
      if (!res.ok) throw new Error('Falha ao buscar indicadores');
      return await res.json();
    },
    enabled: !!crecheId && !!tutorId,
    staleTime: 30000,
  });
}

export function useCatalogueSmartIndicators(crecheId: number, itemId: number | undefined) {
  return useQuery({
    queryKey: ['catalogue-smart-indicators', crecheId, itemId],
    queryFn: async () => {
      if (!itemId) return null;
      const token = localStorage.getItem('auth_token');
      const res = await fetch(\`/api/creches/\${crecheId}/catalogue/\${itemId}/stats\`, {
        headers: { Authorization: \`Bearer \${token}\` }
      });
      if (!res.ok) throw new Error('Falha ao buscar indicadores');
      return await res.json();
    },
    enabled: !!crecheId && !!itemId,
    staleTime: 30000,
  });
}
`;

fs.writeFileSync(path, content + newHooks, 'utf8');
console.log('Fixed hooks file');
