import { NativeModules } from 'react-native';

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
  return AlarmCore.saveWorkScheduleJson(JSON.stringify(schedule));
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
  return AlarmCore.deleteWorkSchedule(scheduleId);
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
  return AlarmCore.setActiveSchedule(scheduleId);
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
  return AlarmCore.saveDayOverridesJson(scheduleId, JSON.stringify(overrides));
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
  return AlarmCore.saveCustomEventJson(JSON.stringify(event));
}

export async function loadCustomEvents(): Promise<NativeCustomEvent[]> {
  const json: string = await AlarmCore.loadCustomEventsJson();
  return JSON.parse(json);
}

export function deleteCustomEvent(eventId: string): Promise<void> {
  return AlarmCore.deleteCustomEvent(eventId);
}

export type NativeSchedulePause = {
  id: string;
  scheduleId: string;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD"
  label: string;
};

export function saveSchedulePause(pause: NativeSchedulePause): Promise<void> {
  return AlarmCore.saveSchedulePauseJson(JSON.stringify(pause));
}

export async function loadSchedulePauses(scheduleId: string): Promise<NativeSchedulePause[]> {
  const json: string = await AlarmCore.loadSchedulePausesJson(scheduleId);
  return JSON.parse(json);
}

export function deleteSchedulePause(pauseId: string): Promise<void> {
  return AlarmCore.deleteSchedulePause(pauseId);
}