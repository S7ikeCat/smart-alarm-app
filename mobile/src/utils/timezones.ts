/** Города для будильника «по чужому времени». IANA-имя учитывает переход на летнее время само. */
export type CityZone = { tz: string; ru: string; en: string };

export const CITY_ZONES: CityZone[] = [
  { tz: 'Europe/Kaliningrad', ru: 'Калининград', en: 'Kaliningrad' },
  { tz: 'Europe/Moscow', ru: 'Москва', en: 'Moscow' },
  { tz: 'Europe/Samara', ru: 'Самара', en: 'Samara' },
  { tz: 'Asia/Yekaterinburg', ru: 'Екатеринбург', en: 'Yekaterinburg' },
  { tz: 'Asia/Omsk', ru: 'Омск', en: 'Omsk' },
  { tz: 'Asia/Novosibirsk', ru: 'Новосибирск', en: 'Novosibirsk' },
  { tz: 'Asia/Krasnoyarsk', ru: 'Красноярск', en: 'Krasnoyarsk' },
  { tz: 'Asia/Irkutsk', ru: 'Иркутск', en: 'Irkutsk' },
  { tz: 'Asia/Yakutsk', ru: 'Якутск', en: 'Yakutsk' },
  { tz: 'Asia/Vladivostok', ru: 'Владивосток', en: 'Vladivostok' },
  { tz: 'Asia/Magadan', ru: 'Магадан', en: 'Magadan' },
  { tz: 'Asia/Kamchatka', ru: 'Петропавловск-Камчатский', en: 'Kamchatka' },
  { tz: 'Europe/Kyiv', ru: 'Киев', en: 'Kyiv' },
  { tz: 'Europe/Minsk', ru: 'Минск', en: 'Minsk' },
  { tz: 'Asia/Almaty', ru: 'Алматы', en: 'Almaty' },
  { tz: 'Asia/Tashkent', ru: 'Ташкент', en: 'Tashkent' },
  { tz: 'Asia/Tbilisi', ru: 'Тбилиси', en: 'Tbilisi' },
  { tz: 'Asia/Yerevan', ru: 'Ереван', en: 'Yerevan' },
  { tz: 'Asia/Baku', ru: 'Баку', en: 'Baku' },
  { tz: 'Europe/Istanbul', ru: 'Стамбул', en: 'Istanbul' },
  { tz: 'Asia/Dubai', ru: 'Дубай', en: 'Dubai' },
  { tz: 'Asia/Kolkata', ru: 'Дели', en: 'Delhi' },
  { tz: 'Asia/Bangkok', ru: 'Бангкок', en: 'Bangkok' },
  { tz: 'Asia/Shanghai', ru: 'Пекин / Шанхай', en: 'Beijing / Shanghai' },
  { tz: 'Asia/Singapore', ru: 'Сингапур', en: 'Singapore' },
  { tz: 'Asia/Seoul', ru: 'Сеул', en: 'Seoul' },
  { tz: 'Asia/Tokyo', ru: 'Токио', en: 'Tokyo' },
  { tz: 'Australia/Sydney', ru: 'Сидней', en: 'Sydney' },
  { tz: 'Pacific/Auckland', ru: 'Окленд', en: 'Auckland' },
  { tz: 'Europe/London', ru: 'Лондон', en: 'London' },
  { tz: 'Europe/Lisbon', ru: 'Лиссабон', en: 'Lisbon' },
  { tz: 'Europe/Paris', ru: 'Париж', en: 'Paris' },
  { tz: 'Europe/Berlin', ru: 'Берлин', en: 'Berlin' },
  { tz: 'Europe/Rome', ru: 'Рим', en: 'Rome' },
  { tz: 'Europe/Athens', ru: 'Афины', en: 'Athens' },
  { tz: 'Africa/Cairo', ru: 'Каир', en: 'Cairo' },
  { tz: 'America/Sao_Paulo', ru: 'Сан-Паулу', en: 'São Paulo' },
  { tz: 'America/New_York', ru: 'Нью-Йорк', en: 'New York' },
  { tz: 'America/Chicago', ru: 'Чикаго', en: 'Chicago' },
  { tz: 'America/Denver', ru: 'Денвер', en: 'Denver' },
  { tz: 'America/Los_Angeles', ru: 'Лос-Анджелес', en: 'Los Angeles' },
];

export function cityByTz(tz: string | null | undefined): CityZone | undefined {
  return CITY_ZONES.find(c => c.tz === tz);
}

export function cityName(tz: string | null | undefined): string {
  const c = cityByTz(tz);
  return c ? c.ru : tz ?? '';
}

/** Поиск по русскому и английскому названию, без учёта регистра и «ё». */
export function searchCities(query: string): CityZone[] {
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();
  const q = norm(query);
  if (!q) return CITY_ZONES;
  return CITY_ZONES.filter(c => norm(c.ru).includes(q) || norm(c.en).includes(q));
}
