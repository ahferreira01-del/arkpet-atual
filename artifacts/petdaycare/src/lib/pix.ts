/**
 * Normaliza qualquer formato de chave Pix para o valor aceito pelo BR Code:
 *  - CPF  (11 dígitos, com ou sem pontuação)   → apenas dígitos
 *  - CNPJ (14 dígitos, com ou sem pontuação)   → apenas dígitos
 *  - Celular brasileiro (10 ou 11 dígitos)      → +55XXXXXXXXXXX
 *  - E-mail                                     → sem alteração
 *  - Chave aleatória (UUID)                     → sem alteração
 *  - Número já com +55                          → sem alteração
 */
function normalizePixKey(raw: string): string {
  const key = raw.trim();

  // Se já tem o prefixo internacional, não mexe.
  if (/^\+55\d{10,11}$/.test(key)) return key;

  // E-mail → usa como está.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) return key;

  // UUID (chave aleatória) → usa como está.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) return key;

  // Remove a pontuação de CPF/CNPJ e celular formatado (pontos, traço, barra, parênteses, espaços).
  const digits = key.replace(/[\s.\-/()+]/g, "");

  if (/^\d{14}$/.test(digits)) {
    // CNPJ — dígitos puros aceitos pelo Banco Central.
    return digits;
  }

  if (/^\d{11}$/.test(digits)) {
    // 11 dígitos: distingue celular de CPF pelo padrão de DDD+9+número.
    // Celular: 2 dígitos de DDD + dígito 9 + 8 dígitos → DD9XXXXXXXX
    if (/^[1-9]{2}9\d{8}$/.test(digits)) {
      return `+55${digits}`;
    }
    // CPF (ou número sem padrão de celular) → dígitos puros.
    return digits;
  }

  if (/^\d{10}$/.test(digits)) {
    // Celular no formato antigo (sem o 9 extra) → +55 + DDD + número.
    return `+55${digits}`;
  }

  // Qualquer outro formato (e-mail com pontuação estranha, etc.) → usa como está.
  return key;
}

/**
 * Gera o payload BR Code do PIX (EMV/QR Code).
 */
export function generatePixPayload(
  pixKey: string,
  merchantName: string,
  merchantCity: string,
  amount: number,
  txid: string = "***"
): string {
  const format = (id: string, value: string) => {
    const size = value.length.toString().padStart(2, "0");
    return `${id}${size}${value}`;
  };

  // Remove acentos e caracteres fora do ASCII imprimível (exigência do EMV).
  const cleanString = (str: string) =>
    str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 ]/g, "");

  const cleanPixKey = normalizePixKey(pixKey);

  const merchantAccountInformation = format(
    "26",
    format("00", "br.gov.bcb.pix") + format("01", cleanPixKey)
  );
  const merchantCategoryCode = format("52", "0000");
  const transactionCurrency = format("53", "986");
  const transactionAmount = amount ? format("54", amount.toFixed(2)) : "";
  const countryCode = format("58", "BR");

  // Limita os campos aos tamanhos máximos permitidos pelo EMV.
  const merchantNameStr = format("59", cleanString(merchantName).substring(0, 25).trim());
  const merchantCityStr = format("60", cleanString(merchantCity).substring(0, 15).trim());
  const additionalDataFieldTemplate = format("62", format("05", txid));

  const payload = `${merchantAccountInformation}${merchantCategoryCode}${transactionCurrency}${transactionAmount}${countryCode}${merchantNameStr}${merchantCityStr}${additionalDataFieldTemplate}6304`;
  const fullPayload = format("00", "01") + payload;

  // CRC-16 CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF).
  let crc = 0xffff;
  for (let i = 0; i < fullPayload.length; i++) {
    crc ^= fullPayload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  const crcStr = (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");

  return fullPayload + crcStr;
}
