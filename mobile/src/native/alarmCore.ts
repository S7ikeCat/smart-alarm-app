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