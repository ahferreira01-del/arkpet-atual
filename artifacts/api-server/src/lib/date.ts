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

/**
 * Valida estritamente se uma string é uma data de calendário real no formato YYYY-MM-DD.
 */
export function isValidCalendarDate(str: any): boolean {
  if (typeof str !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [yearStr, monthStr, dayStr] = str.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/**
 * Retorna o próximo dia do calendário (YYYY-MM-DD) usando matemática UTC pura,
 * livre de efeitos colaterais de fuso horário do host.
 */
export function getNextCalendarDay(dateStr: string): string {
  const [yStr, mStr, dStr] = dateStr.split("-");
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  const utcDate = new Date(Date.UTC(year, month - 1, day + 1));
  const nextY = utcDate.getUTCFullYear();
  const nextM = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const nextD = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${nextY}-${nextM}-${nextD}`;
}

/**
 * Retorna um dia anterior do calendário (YYYY-MM-DD) usando matemática UTC pura.
 */
export function getPreviousCalendarDay(dateStr: string, daysBack: number = 30): string {
  const [yStr, mStr, dStr] = dateStr.split("-");
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);
  const utcDate = new Date(Date.UTC(year, month - 1, day - daysBack));
  const prevY = utcDate.getUTCFullYear();
  const prevM = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const prevD = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${prevY}-${prevM}-${prevD}`;
}

/**
 * Converte uma data de calendário (YYYY-MM-DD) no fuso IANA especificado (padrão: "America/Sao_Paulo")
 * para o instante UTC exato (Date) correspondente ao início do dia de negócio (00:00:00.000 local).
 * Utiliza o motor IANA do Node.js (Intl.DateTimeFormat) sem offsets estáticos ou dependências de host.
 */
export function getBusinessDayStartInstant(dateStr: string, timeZone: string = "America/Sao_Paulo"): Date {
  const [yStr, mStr, dStr] = dateStr.split("-");
  const targetYear = parseInt(yStr, 10);
  const targetMonth = parseInt(mStr, 10);
  const targetDay = parseInt(dStr, 10);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });

  const getOffsetMs = (instant: Date): number => {
    const parts = formatter.formatToParts(instant);
    const get = (type: string): number => {
      const part = parts.find(p => p.type === type);
      return part ? parseInt(part.value, 10) : 0;
    };
    const y = get("year");
    const m = get("month");
    const d = get("day");
    let h = get("hour");
    if (h === 24) h = 0;
    const min = get("minute");
    const s = get("second");
    const localUtcMs = Date.UTC(y, m - 1, d, h, min, s);
    return localUtcMs - instant.getTime();
  };

  const targetLocalUtc = Date.UTC(targetYear, targetMonth - 1, targetDay, 0, 0, 0);
  const guess = new Date(targetLocalUtc);
  const offsetMs = getOffsetMs(guess);
  let result = new Date(targetLocalUtc - offsetMs);

  const refinedOffset = getOffsetMs(result);
  if (refinedOffset !== offsetMs) {
    result = new Date(targetLocalUtc - refinedOffset);
  }

  return result;
}
