import { getSetting, setSetting } from './appSettings';

/** «Папка» серии будильников. Хранится в настройках приложения: сами будильники лежат в базе как обычно. */
export type AlarmSeries = {
  id: string;
  name: string;
  alarmIds: string[];
};

const KEY = 'alarm_series';

export async function loadSeries(): Promise<AlarmSeries[]> {
  try {
    const raw = await getSetting(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSeriesList(list: AlarmSeries[]): Promise<void> {
  return setSetting(KEY, JSON.stringify(list));
}
