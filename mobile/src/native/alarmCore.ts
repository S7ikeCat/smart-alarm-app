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