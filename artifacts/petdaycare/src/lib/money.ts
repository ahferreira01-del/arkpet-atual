/**
 * Formats a monetary value strictly represented in integer CENTS into a Brazilian Real (pt-BR) display string.
 *
 * @param cents Integer representing the monetary value in cents (e.g., 15000 for R$ 150,00).
 * @returns Formatted currency string.
 */
export function formatCentsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Parses a string input representing Brazilian Reais (e.g. "19.99" or "19,99") 
 * into an integer representing cents.
 *
 * @param value The string from the input field.
 * @returns An integer in cents, or null if the input is invalid or empty.
 */
export function parseReaisInputToCents(value: string): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  // Aceita opcionalmente sinal negativo, seguido de dígitos e no máximo um separador decimal (, ou .) com 1 a 2 casas.
  const isValidFormat = /^-?\d+([.,]\d{1,2})?$/.test(trimmed);
  if (!isValidFormat) return null;

  const normalized = trimmed.replace(",", ".");
  const parsedFloat = parseFloat(normalized);
  
  if (isNaN(parsedFloat)) return null;

  return Math.round(parsedFloat * 100);
}
