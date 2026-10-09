import {
  NativeAlarmTimeOverride,
  NativeWorkSchedule,
  deleteAlarmTimeOverride,
} from '../native/alarmCore';
import { addMinutesToTime, dateToKey } from './timeUtils';

type WorkCheck = {
  workDates: Set<string>; // даты (YYYY-MM-DD), в которые по графику есть будильник
  checkUntilKey: string; // дальше этой даты наличие смены не проверяем (за пределами окна генерации)
};

/** Обычное время правила по графику, "HH:MM". */
export function baseTimeOfRule(schedule: NativeWorkSchedule, ruleId: string): string | null {
  const rule = schedule.alarms.find(a => a.id === ruleId);
  if (!rule) return null;
  return addMinutesToTime(schedule.shiftStartTime, -rule.offsetMinutes).slice(0, 5);
}

/**
 * "Время на дату" лишнее, если оно ничего не меняет или ссылается на то,
 * чего уже нет: совпало с обычным временем, дата в прошлом, правила больше
 * нет, либо в этот день теперь нет смены. Такие записи удаляем, чтобы не
 * висела голубая метка "изменено" там, где на деле ничего не изменено.
 */
export function isRedundantOverride(
  o: NativeAlarmTimeOverride,
  schedule: NativeWorkSchedule,
  todayKey: string,
  workCheck?: WorkCheck,
): boolean {
  const base = baseTimeOfRule(schedule, o.ruleId);
  if (base === null) return true;
  if (o.timeLocal.slice(0, 5) === base) return true;
  if (o.date < todayKey) return true;
  if (workCheck && o.date <= workCheck.checkUntilKey && !workCheck.workDates.has(o.date)) {
    return true;
  }
  return false;
}

/** Удаляет лишние записи и возвращает оставшиеся (настоящие) изменения. */
export async function pruneTimeOverrides(
  schedule: NativeWorkSchedule,
  overrides: NativeAlarmTimeOverride[],
  workCheck?: WorkCheck,
): Promise<NativeAlarmTimeOverride[]> {
  const todayKey = dateToKey(new Date());
  const keep: NativeAlarmTimeOverride[] = [];
  for (const o of overrides) {
    if (isRedundantOverride(o, schedule, todayKey, workCheck)) {
      try {
        await deleteAlarmTimeOverride(o.scheduleId, o.date, o.ruleId);
      } catch (error) {
        console.log('Не удалось убрать лишнее время на дату:', error);
        keep.push(o);
      }
    } else {
      keep.push(o);
    }
  }
  return keep;
}
