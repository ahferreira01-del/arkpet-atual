/**
 * Função para gerar o payload BR Code do PIX (EMV).
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

  const payloadFormatIndicator = format("00", "01");
  // Limpa caracteres especiais e acentos que quebram o parser do banco
  const cleanString = (str: string) =>
    str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 ]/g, "");

  // Pix Keys do tipo Celular precisam do +55 na frente. Se o usuário digitou só 11 números, e o terceiro for 9, adicionamos o +55.
  let cleanPixKey = pixKey.trim();
  if (/^\d{11}$/.test(cleanPixKey) && cleanPixKey[2] === "9") {
    cleanPixKey = `+55${cleanPixKey}`;
  } else if (/^\d{10}$/.test(cleanPixKey)) {
    // Celular sem o 9
    cleanPixKey = `+55${cleanPixKey}`;
  }

  const merchantAccountInformation = format(
    "26",
    format("00", "br.gov.bcb.pix") + format("01", cleanPixKey)
  );
  const merchantCategoryCode = format("52", "0000");
  const transactionCurrency = format("53", "986");
  const transactionAmount = amount ? format("54", amount.toFixed(2)) : "";
  const countryCode = format("58", "BR");
  
  // Limita os campos aos tamanhos máximos permitidos pelo EMV
  const merchantNameStr = format("59", cleanString(merchantName).substring(0, 25).trim());
  const merchantCityStr = format("60", cleanString(merchantCity).substring(0, 15).trim());
  const additionalDataFieldTemplate = format("62", format("05", txid));

  const payload = `${payloadFormatIndicator}${merchantAccountInformation}${merchantCategoryCode}${transactionCurrency}${transactionAmount}${countryCode}${merchantNameStr}${merchantCityStr}${additionalDataFieldTemplate}6304`;

  // Calcula o CRC16 (CCITT-FALSE, polynomial 0x1021, inicial 0xFFFF)
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
    }
  }
  const crcStr = (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");

  return payload + crcStr;
}
