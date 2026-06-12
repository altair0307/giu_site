export const KOREA_TIME_ZONE = "Asia/Seoul";

export function createKoreaDateFormatter(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ko-KR", {
    ...options,
    timeZone: KOREA_TIME_ZONE
  });
}

export function formatKoreaDateTimeLocal(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: KOREA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function parseKoreaDateTimeLocal(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("날짜와 시간을 올바르게 입력해주세요.");
  }

  const date = new Date(`${value}:00+09:00`);

  if (Number.isNaN(date.getTime()) || formatKoreaDateTimeLocal(date) !== value) {
    throw new Error("날짜와 시간을 올바르게 입력해주세요.");
  }

  return date;
}
