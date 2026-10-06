import { syncAlarmsNow } from './alarmScheduler';

/**
 * Вся логика синхронизации теперь в нативном AlarmSyncer.kt, чтобы она
 * работала и без JS (после перезагрузки или обновления приложения).
 * Эта функция оставлена как тонкая обёртка для CalendarScreen.
 */
export function syncSystemAlarms(): Promise<void> {
  return syncAlarmsNow();
}