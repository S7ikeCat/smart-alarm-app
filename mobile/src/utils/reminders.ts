import type { NativeCustomEvent, ReminderRepeat } from '../native/alarmCore';
import { addDaysToKey, formatKeyLong } from './timeUtils';

/** Умные списки сверху, как в напоминаниях iPhone. */
export type SmartFilter = 'today' | 'planned' | 'all' | 'flagged' | 'urgent' | 'done';

export const SMART_TITLES: Record<SmartFilter, string> = {
  today: 'Сегодня',
  planned: 'В планах',
  all: 'Все',
  flagged: 'С флажком',
  urgent: 'Срочное',
  done: 'Завершено',
};

export const REPEAT_LABELS: Record<ReminderRepeat, string> = {
  ONCE: 'Не повторять',
  DAILY: 'Каждый день',
  WEEKDAYS: 'По будням',
  WEEKLY: 'Каждую неделю',
  MONTHLY: 'Каждый месяц',
  YEARLY: 'Каждый год',
};

export const REPEAT_OPTIONS: ReminderRepeat[] = ['ONCE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY', 'YEARLY'];

/** Цвет по умолчанию, если у напоминания нет списка. */
export const DEFAULT_REMINDER_COLOR = '#E8875A';

/** Цвета для списков. */
export const LIST_COLORS = ['#4A90D9', '#E8A33D', '#4A7A6B', '#C0453A', '#B08AC7', '#6B8CAE'];

/** Фильтр для умных списков. todayKey — "YYYY-MM-DD" (даты сравниваются как строки). */
export function filterSmart(events: NativeCustomEvent[], filter: SmartFilter, todayKey: string) {
  const open = events.filter(e => !e.completed);
  switch (filter) {
    case 'today':
      return open.filter(e => e.date <= todayKey);
    case 'planned':
      return open.filter(e => e.date > todayKey);
    case 'all':
      return open;
    case 'flagged':
      return open.filter(e => !!e.flagged);
    case 'urgent':
      return open.filter(e => !!e.urgent && e.reminderEnabled);
    case 'done':
      return events.filter(e => !!e.completed);
  }
}

export function sortByDateTime(events: NativeCustomEvent[]) {
  return [...events].sort((a, b) => (a.date + a.timeLocal).localeCompare(b.date + b.timeLocal));
}

/** "Сегодня" / "Завтра" / "чт, 15 октября". */
export function dateLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'Сегодня';
  if (key === addDaysToKey(todayKey, 1)) return 'Завтра';
  if (key === addDaysToKey(todayKey, -1)) return 'Вчера';
  return formatKeyLong(key);
}

export function groupByDate(events: NativeCustomEvent[]): { date: string; items: NativeCustomEvent[] }[] {
  const groups: { date: string; items: NativeCustomEvent[] }[] = [];
  for (const e of sortByDateTime(events)) {
    const last = groups[groups.length - 1];
    if (last && last.date === e.date) last.items.push(e);
    else groups.push({ date: e.date, items: [e] });
  }
  return groups;
}
