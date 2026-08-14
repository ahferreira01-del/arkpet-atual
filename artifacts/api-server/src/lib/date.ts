/**
 * Retorna a data de negócio (YYYY-MM-DD) no fuso horário especificado.
 * Padrão: "America/Sao_Paulo" (Horário de Brasília).
 * 
 * Utilize esta função sempre que precisar calcular datas de vencimento (dueDate),
 * datas de reservas, datas de relatórios financeiros e outras datas comerciais,
 * para evitar problemas de conversão de UTC (onde 21:00 BRT = 00:00 do dia seguinte).
 * 
 * Para timestamps técnicos (createdAt, updatedAt, logs de auditoria),
 * continue utilizando new Date().toISOString() ou Date.now() em UTC.
 */
export function getBusinessDate(timeZone: string = "America/Sao_Paulo"): string {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}
