import { NativeModules } from 'react-native';

const { AlarmCore } = NativeModules;

/** Простое хранилище настроек "ключ → строка" (Android SharedPreferences). */
export async function getSetting(key: string): Promise<string | null> {
  const value: string | null | undefined = await AlarmCore.getSetting(key);
  return value ?? null;
}

export function setSetting(key: string, value: string): Promise<void> {
  return AlarmCore.setSetting(key, value);
}

export function removeSetting(key: string): Promise<void> {
  return AlarmCore.removeSetting(key);
}

// --- Конкретные настройки -----------------------------------------------------

export const REST_TITLE_DEFAULT = 'Сегодня твой день';
export const REST_TITLE_LIMIT = 28;
const REST_TITLE_KEY = 'rest_title';

/** Текст на главной в выходной. Пусто или ошибка чтения — стандартный. */
export async function loadRestTitle(): Promise<string> {
  try {
    const value = await getSetting(REST_TITLE_KEY);
    const trimmed = value?.trim();
    return trimmed ? trimmed.slice(0, REST_TITLE_LIMIT) : REST_TITLE_DEFAULT;
  } catch {
    return REST_TITLE_DEFAULT;
  }
}

/** Пустая строка возвращает стандартный текст. */
export async function saveRestTitle(text: string): Promise<void> {
  const trimmed = text.trim().slice(0, REST_TITLE_LIMIT);
  if (trimmed.length === 0 || trimmed === REST_TITLE_DEFAULT) {
    await removeSetting(REST_TITLE_KEY);
  } else {
    await setSetting(REST_TITLE_KEY, trimmed);
  }
}

// --- Настройки звонка ----------------------------------------------------------
// Те же ключи читает нативный AlarmSettings.kt, поэтому звонок следует им
// даже при убитом приложении.

export type RingSettings = {
  snoozeMinutes: number; // через сколько минут повторить
  snoozeLimit: number; // сколько раз можно отложить, 0 = без лимита
  fadeInSeconds: number; // за сколько секунд громкость нарастает, 0 = сразу
  vibration: boolean;
  ringtoneUri: string | null; // null = стандартный системный будильник
  ringtoneTitle: string;
};

export const RING_DEFAULTS: RingSettings = {
  snoozeMinutes: 5,
  snoozeLimit: 3,
  fadeInSeconds: 10,
  vibration: true,
  ringtoneUri: null,
  ringtoneTitle: 'Стандартная',
};

function toInt(value: string | null, fallback: number): number {
  const n = value === null ? NaN : parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function loadRingSettings(): Promise<RingSettings> {
  try {
    const [snooze, limit, fade, vibration, uri, title] = await Promise.all([
      getSetting('snooze_minutes'),
      getSetting('snooze_limit'),
      getSetting('fade_in_seconds'),
      getSetting('vibration'),
      getSetting('ringtone_uri'),
      getSetting('ringtone_title'),
    ]);
    const hasUri = uri !== null && uri.trim().length > 0;
    return {
      snoozeMinutes: toInt(snooze, RING_DEFAULTS.snoozeMinutes),
      snoozeLimit: toInt(limit, RING_DEFAULTS.snoozeLimit),
      fadeInSeconds: toInt(fade, RING_DEFAULTS.fadeInSeconds),
      vibration: vibration !== '0',
      ringtoneUri: hasUri ? uri : null,
      ringtoneTitle: hasUri && title ? title : RING_DEFAULTS.ringtoneTitle,
    };
  } catch {
    return RING_DEFAULTS;
  }
}

export function saveSnoozeMinutes(value: number) {
  return setSetting('snooze_minutes', String(value));
}
export function saveSnoozeLimit(value: number) {
  return setSetting('snooze_limit', String(value));
}
export function saveFadeInSeconds(value: number) {
  return setSetting('fade_in_seconds', String(value));
}
export function saveVibration(value: boolean) {
  return setSetting('vibration', value ? '1' : '0');
}

export type PickedRingtone = { uri: string; title: string };

function parsePicked(json: string | null | undefined): PickedRingtone | null {
  if (!json) return null;
  return JSON.parse(json) as PickedRingtone;
}

/** Системное окно выбора мелодии. null — человек закрыл окно, ничего не выбрав. */
export async function pickSystemRingtone(currentUri: string | null): Promise<PickedRingtone | null> {
  return parsePicked(await AlarmCore.pickSystemRingtone(currentUri ?? ''));
}

/** Свой аудиофайл через системный файловый диалог. */
export async function pickAudioFile(): Promise<PickedRingtone | null> {
  return parsePicked(await AlarmCore.pickAudioFile());
}

export async function saveRingtone(picked: PickedRingtone | null): Promise<void> {
  if (picked === null) {
    await removeSetting('ringtone_uri');
    await removeSetting('ringtone_title');
  } else {
    await setSetting('ringtone_uri', picked.uri);
    await setSetting('ringtone_title', picked.title);
  }
}

export function previewRingtone(uri: string | null): Promise<void> {
  return AlarmCore.previewRingtone(uri ?? '');
}

export function stopRingtonePreview(): Promise<void> {
  return AlarmCore.stopPreview();
}
