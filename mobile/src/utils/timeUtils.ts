import type { ExtraAlarmKind } from '../native/alarmCore';

/** Случайный UUID v4 — ядро на Rust принимает id только в таком формате. */
export function newId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "HH:MM" или "HH:MM:SS" -> часы и минуты. */
export function parseTime(t: string): { h: number; m: number } {
  const [h, m] = t.split(':');
  return { h: parseInt(h, 10), m: parseInt(m, 10) };
}

/** Часы и минуты -> "HH:MM:00" (формат, который ждёт ядро). */
export function makeTime(h: number, m: number): string {
  return `${pad2(h)}:${pad2(m)}:00`;
}

export function shortTime(t: string): string {
  return t.slice(0, 5);
}

/** Сдвигает время на delta минут по кругу суток (23:50 + 20 = 00:10). */
export function addMinutesToTime(t: string, delta: number): string {
  const { h, m } = parseTime(t);
  const total = (((h * 60 + m + delta) % 1440) + 1440) % 1440;
  return makeTime(Math.floor(total / 60), total % 60);
}

export function dateToKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function keyToDate(k: string): Date {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDaysToKey(k: string, n: number): string {
  const d = keyToDate(k);
  d.setDate(d.getDate() + n);
  return dateToKey(d);
}

export function formatKeyLong(k: string): string {
  return keyToDate(k).toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
}

export const KIND_LABELS: Record<ExtraAlarmKind, string> = {
  WORK_DAYS: 'Рабочие дни',
  REST_DAYS: 'Выходные',
  ALL_DAYS: 'Каждый день',
  ONE_DATE: 'Одна дата',
};
