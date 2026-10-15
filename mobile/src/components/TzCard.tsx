import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { SelectRow } from './SelectRow';
import { convertEventTime } from '../native/alarmCore';
import { CITY_ZONES, cityName } from '../utils/timezones';
import { keyToDate, shortTime } from '../utils/timeUtils';

type Props = {
  on: boolean;
  onToggle: (on: boolean) => void;
  tz: string;
  onTz: (tz: string) => void;
  time: string; // "HH:MM:SS" — время в выбранном городе
  date: string; // "YYYY-MM-DD" — на какую дату считать подсказку
};

/** Карточка «Время в другом часовом поясе»: переключатель, город и короткая подсказка пересчёта. */
export function TzCard({ on, onToggle, tz, onTz, time, date }: Props) {
  const [preview, setPreview] = useState<{ date: string; timeLocal: string } | null>(null);

  useEffect(() => {
    if (!on) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    convertEventTime(date, time, tz, 0)
      .then(r => !cancelled && setPreview(r))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [on, date, time, tz]);

  function dayWord(localDate: string): string {
    const diff = Math.round((keyToDate(localDate).getTime() - keyToDate(date).getTime()) / 86400000);
    if (diff === 0) return '';
    return diff < 0 ? ' (днём раньше)' : ' (днём позже)';
  }

  return (
    <View style={styles.group}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Время в другом часовом поясе</Text>
          <Text style={styles.note}>Встреча или звонок по времени другого города.</Text>
        </View>
        <Switch
          value={on}
          onValueChange={onToggle}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={colors.textPrimary}
        />
      </View>
      {on && (
        <>
          <SelectRow
            title="Город"
            variant="dialog"
            searchable
            value={tz}
            onChange={onTz}
            options={CITY_ZONES.map(c => ({ value: c.tz, label: c.ru }))}
          />
          {preview && (
            <View style={styles.previewBox}>
              <Text style={styles.preview} numberOfLines={2}>
                {shortTime(time)} в {cityName(tz)} → {shortTime(preview.timeLocal)} у тебя
                {dayWord(preview.date)}
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.body, color: colors.textPrimary },
  note: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  previewBox: {
    backgroundColor: 'rgba(232,135,90,0.12)',
    borderRadius: 12,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  preview: { fontSize: 12, color: colors.accent },
});
