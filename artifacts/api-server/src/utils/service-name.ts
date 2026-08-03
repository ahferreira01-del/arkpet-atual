/**
 * Normalizes a service name to a base type for matching purposes.
 *
 * Strips size qualifiers (pequeno/médio/grande and their variants) so that
 * "Banho Pequeno", "Banho Médio" and "Banho Grande" all reduce to "banho".
 * This lets a service credit purchased for one size apply to any booking of
 * the same base service, regardless of the pet's porte.
 *
 * Examples:
 *   "Banho Pequeno"     → "banho"
 *   "Banho Grande"      → "banho"
 *   "Tosa Completa"     → "tosa_completa"
 *   "Tosa Completa Grde"→ "tosa_completa"
 *   "Hidratação"        → "hidratacao"
 */
const SIZE_WORDS = new Set([
  'pequeno', 'pequena', 'medio', 'media', 'mediano', 'mediana',
  'grande', 'small', 'medium', 'large', 'mini', 'maxi', 'plus',
  // common PT abbreviations used as size labels
  'p', 'm', 'g', 'gg', 'xg',
]);

export function normalizeServiceType(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, '')     // keep only letters, digits, spaces
    .split(/\s+/)
    .filter(w => w.length > 0 && !SIZE_WORDS.has(w))
    .join('_');
  return slug || 'servico';
}
