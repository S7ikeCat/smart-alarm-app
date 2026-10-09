import { NativeModules } from 'react-native';
import { syncAlarmsNow } from './alarmScheduler';

// Любое изменение данных сразу пересчитывает системные будильники,
// чтобы они не отставали от графика, пока приложение не открыли заново.
function syncAfter<T>(promise: Promise<T>): Promise<T> {
  return promise.then(async result => {
    try {
      await syncAlarmsNow();
    } catch (e) {
      console.log('Не удалось синхронизировать будильники:', e);
    }
    return result;
  });
}

const { AlarmCore } = NativeModules;

export type NativeAlarmRule = {
  id: string;
  offsetMinutes: number;
  ringtoneId: string;
  vibration: boolean;
};

export type NativeWorkSchedule = {
  id: string;
  name: string;
  color: string;
  pattern: boolean[]; // true = рабочий день
  sourcePresetId: string | null; // null = "свой график"
  startDate: string; // "YYYY-MM-DD"
  shiftStartTime: string; // "HH:MM:SS"
  alarms: NativeAlarmRule[];
  isActive: boolean;
  isPaused: boolean;
};

/**
 * Сохраняет график в SQLite через Rust-ядро. Выбрасывает исключение,
 * если Kotlin-сторона вернула ошибку (см. AlarmCoreModule.saveWorkScheduleJson).
 */
export function saveWorkSchedule(schedule: NativeWorkSchedule): Promise<void> {
  return syncAfter(AlarmCore.saveWorkScheduleJson(JSON.stringify(schedule)));
}

/**
 * Загружает все сохранённые графики из SQLite через Rust-ядро.
 */
export async function loadWorkSchedules(): Promise<NativeWorkSchedule[]> {
  const json: string = await AlarmCore.loadWorkSchedulesJson();
  return JSON.parse(json);
}

/**
 * Удаляет график из SQLite по id (вместе со всеми его будильниками —
 * см. ON DELETE CASCADE в схеме БД).
 */
export function deleteWorkSchedule(scheduleId: string): Promise<void> {
  return syncAfter(AlarmCore.deleteWorkSchedule(scheduleId));
}

export type NativeAlarmInstance = {
  id: string;
  scheduleId: string;
  date: string; // "YYYY-MM-DD"
  timeLocal: string; // "HH:MM:SS"
  status: 'ACTIVE' | 'SKIPPED_BY_USER' | 'FIRED' | 'MISSED';
  origin: 'FROM_PATTERN' | 'MANUAL_OVERRIDE' | 'TIMEZONE_MEETING';
};

/**
 * Делает график активным, снимая активность со всех остальных
 * (строго один активный график — см. set_active_schedule_ffi в Rust-ядре).
 */
export function setActiveSchedule(scheduleId: string): Promise<void> {
  return syncAfter(AlarmCore.setActiveSchedule(scheduleId));
}

/**
 * Генерирует и возвращает ближайшие будильники со всех активных графиков,
 * уже объединённые и отсортированные по дате/времени.
 */
export async function generateUpcomingAlarms(
  horizonMonths: number,
): Promise<NativeAlarmInstance[]> {
  const json: string = await AlarmCore.generateUpcomingAlarmsJson(horizonMonths);
  return JSON.parse(json);
}

export type NativeDayOverride = {
  date: string; // "YYYY-MM-DD"
  isWork: boolean;
};

/**
 * Полностью заменяет overrides конкретного графика на переданный набор.
 */
export function saveDayOverrides(
  scheduleId: string,
  overrides: NativeDayOverride[],
): Promise<void> {
  return syncAfter(AlarmCore.saveDayOverridesJson(scheduleId, JSON.stringify(overrides)));
}

/**
 * Загружает все overrides конкретного графика.
 */
export async function loadDayOverrides(scheduleId: string): Promise<NativeDayOverride[]> {
  const json: string = await AlarmCore.loadDayOverridesJson(scheduleId);
  return JSON.parse(json);
}

export type NativeCustomEvent = {
  id: string;
  date: string; // "YYYY-MM-DD"
  timeLocal: string; // "HH:MM:SS"
  color: string;
  label: string;
  description: string;
  reminderEnabled: boolean;
};

export function saveCustomEvent(event: NativeCustomEvent): Promise<void> {
  return syncAfter(AlarmCore.saveCustomEventJson(JSON.stringify(event)));
}

export async function loadCustomEvents(): Promise<NativeCustomEvent[]> {
  const json: string = await AlarmCore.loadCustomEventsJson();
  return JSON.parse(json);
}

export function deleteCustomEvent(eventId: string): Promise<void> {
  return syncAfter(AlarmCore.deleteCustomEvent(eventId));
}

export type NativeSchedulePause = {
  id: string;
  scheduleId: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  label: string;
};

export function saveSchedulePause(pause: NativeSchedulePause): Promise<void> {
  return syncAfter(AlarmCore.saveSchedulePauseJson(JSON.stringify(pause)));
}

export async function loadSchedulePauses(scheduleId: string): Promise<NativeSchedulePause[]> {
  const json: string = await AlarmCore.loadSchedulePausesJson(scheduleId);
  return JSON.parse(json);
}

export function deleteSchedulePause(pauseId: string): Promise<void> {
  return syncAfter(AlarmCore.deleteSchedulePause(pauseId));
}

// --- Дополнительные будильники ------------------------------------------------

export type ExtraAlarmKind = 'WORK_DAYS' | 'REST_DAYS' | 'ALL_DAYS' | 'ONE_DATE';

export type NativeExtraAlarm = {
  id: string;
  label: string;
  timeLocal: string; // "HH:MM:SS"
  kind: ExtraAlarmKind;
  date: string | null; // только для ONE_DATE, "YYYY-MM-DD"
  enabled: boolean;
};

export function saveExtraAlarm(alarm: NativeExtraAlarm): Promise<void> {
  return syncAfter(AlarmCore.saveExtraAlarmJson(JSON.stringify(alarm)));
}

export async function loadExtraAlarms(): Promise<NativeExtraAlarm[]> {
  const json: string = await AlarmCore.loadExtraAlarmsJson();
  return JSON.parse(json);
}

export function deleteExtraAlarm(alarmId: string): Promise<void> {
  return syncAfter(AlarmCore.deleteExtraAlarm(alarmId));
}

export type NativeExtraAlarmInstance = {
  alarmId: string;
  date: string;
  timeLocal: string;
  label: string;
};

export async function generateExtraAlarms(horizonMonths: number): Promise<NativeExtraAlarmInstance[]> {
  const json: string = await AlarmCore.generateExtraAlarmsJson(horizonMonths);
  return JSON.parse(json);
}

// --- Время будильника графика на конкретную дату ---------------------------------

export type NativeAlarmTimeOverride = {
  scheduleId: string;
  date: string; // "YYYY-MM-DD"
  ruleId: string; // id правила будильника из графика
  timeLocal: string; // "HH:MM:SS"
};

export function saveAlarmTimeOverride(item: NativeAlarmTimeOverride): Promise<void> {
  return syncAfter(AlarmCore.saveAlarmTimeOverrideJson(JSON.stringify(item)));
}

export async function loadAlarmTimeOverrides(scheduleId: string): Promise<NativeAlarmTimeOverride[]> {
  const json: string = await AlarmCore.loadAlarmTimeOverridesJson(scheduleId);
  return JSON.parse(json);
}

export function deleteAlarmTimeOverride(scheduleId: string, date: string, ruleId: string): Promise<void> {
  return syncAfter(AlarmCore.deleteAlarmTimeOverride(scheduleId, date, ruleId));
}