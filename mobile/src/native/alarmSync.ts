import { generateUpcomingAlarms, loadCustomEvents } from './alarmCore';
import { scheduleAlarmInSlot, cancelSlot } from './alarmScheduler';

const SLOT_COUNT = 20;

type SyncableAlarm = {
  id: string;
  label: string;
  triggerAtMillis: number;
};

function parseLocalDateTime(date: string, time: string): number {
  // date: "YYYY-MM-DD", time: "HH:MM:SS" — собираем как локальное время
  // устройства (намеренно не UTC — у нас пока нет часовых поясов, это
  // отдельная задача на будущее, см. память проекта).
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes, seconds] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds).getTime();
}

/**
 * Синхронизирует реальные системные будильники (AlarmManager) с текущими
 * данными — графиками и событиями. Поскольку у AlarmManager нет способа
 * "посмотреть, что сейчас запланировано", мы ВСЕГДА перезаписываем весь
 * фиксированный пул слотов целиком: берём ближайшие SLOT_COUNT будильников,
 * раскладываем по слотам 0..N, а оставшиеся слоты явно отменяем.
 */
export async function syncSystemAlarms(): Promise<void> {
  const now = Date.now();
  const [alarms, events] = await Promise.all([
    generateUpcomingAlarms(2),
    loadCustomEvents(),
  ]);

  const fromSchedule: SyncableAlarm[] = alarms
    .map(a => ({
      id: `schedule:${a.id}`,
      label: 'Рабочая смена',
      triggerAtMillis: parseLocalDateTime(a.date, a.timeLocal),
    }))
    .filter(a => a.triggerAtMillis > now);

  const fromEvents: SyncableAlarm[] = events
    .filter(e => e.reminderEnabled)
    .map(e => ({
      id: `event:${e.id}`,
      label: e.label,
      triggerAtMillis: parseLocalDateTime(e.date, e.timeLocal),
    }))
    .filter(e => e.triggerAtMillis > now);

  const upcoming = [...fromSchedule, ...fromEvents]
    .sort((a, b) => a.triggerAtMillis - b.triggerAtMillis)
    .slice(0, SLOT_COUNT);

  const tasks: Promise<void>[] = [];
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const alarm = upcoming[slot];
    if (alarm) {
      tasks.push(scheduleAlarmInSlot(slot, alarm.triggerAtMillis, alarm.id, alarm.label));
    } else {
      tasks.push(cancelSlot(slot));
    }
  }

  await Promise.all(tasks);
}