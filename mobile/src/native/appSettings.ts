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
