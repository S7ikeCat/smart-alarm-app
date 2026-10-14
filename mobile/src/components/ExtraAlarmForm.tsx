import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { TimeStepper } from './TimeStepper';
import {
  ExtraAlarmKind,
  NativeExtraAlarm,
  saveExtraAlarm,
  deleteExtraAlarm,
  convertEventTime,
} from '../native/alarmCore';
import { CITY_ZONES, cityName, searchCities } from '../utils/timezones';
import {
  KIND_LABELS,
  addDaysToKey,
  dateToKey,
  formatKeyLong,
  newId,
  shortTime,
  keyToDate,
} from '../utils/timeUtils';


const KINDS: ExtraAlarmKind[] = ['WORK_DAYS', 'REST_DAYS', 'ALL_DAYS', 'ONE_DATE'];

/** Выбор "когда звонит" — четыре кнопки-чипа. */
export function KindPicker({
  value,
  onChange,
}: {
  value: ExtraAlarmKind;
  onChange: (kind: ExtraAlarmKind) => void;
}) {
  return (
    <View style={styles.chips}>
      {KINDS.map(kind => (
        <Pressable
          key={kind}
          style={[styles.chip, value === kind && styles.chipActive]}
          onPress={() => onChange(kind)}
        >
          <Text style={[styles.chipText, value === kind && styles.chipTextActive]}>
            {KIND_LABELS[kind]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Выбор даты кнопками: день назад/вперёд и неделя назад/вперёд. */
export function DateStepper({
  value,
  onChange,
}: {
  value: string; // "YYYY-MM-DD"
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.dateRow}>
      <Pressable style={styles.dateBtn} onPress={() => onChange(addDaysToKey(value, -7))}>
        <Text style={styles.dateBtnText}>−7</Text>
      </Pressable>
      <Pressable style={styles.dateBtn} onPress={() => onChange(addDaysToKey(value, -1))}>
        <ChevronLeft color={colors.textPrimary} size={20} />
      </Pressable>
      <Text style={styles.dateText}>{formatKeyLong(value)}</Text>
      <Pressable style={styles.dateBtn} onPress={() => onChange(addDaysToKey(value, 1))}>
        <ChevronRight color={colors.textPrimary} size={20} />
      </Pressable>
      <Pressable style={styles.dateBtn} onPress={() => onChange(addDaysToKey(value, 7))}>
        <Text style={styles.dateBtnText}>+7</Text>
      </Pressable>
    </View>
  );
}

type Props = {
  alarm: NativeExtraAlarm | null; // null = новый
  fixedDate?: string; // режим календаря: будильник привязан к этому дню, выбор "когда звонит" скрыт
  onDone: () => void; // сохранено или удалено — перечитать данные
  onCancel: () => void;
};

/** Форма одного дополнительного будильника (без собственной шторки — её даёт родитель). */
export function ExtraAlarmForm({ alarm, fixedDate, onDone, onCancel }: Props) {
  const [time, setTime] = useState(alarm?.timeLocal ?? '09:00:00');
  const [label, setLabel] = useState(alarm?.label ?? '');
  const [kind, setKind] = useState<ExtraAlarmKind>(
    alarm?.kind ?? (fixedDate ? 'ONE_DATE' : 'REST_DAYS'),
  );
  const [date, setDate] = useState(alarm?.date ?? fixedDate ?? dateToKey(new Date()));
  const [busy, setBusy] = useState(false);
  const [tzOn, setTzOn] = useState(!!alarm?.sourceTz);
  const [tz, setTz] = useState(alarm?.sourceTz ?? CITY_ZONES[3].tz);
  const [query, setQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<{ date: string; timeLocal: string } | null>(null);

  const effectiveKind: ExtraAlarmKind = tzOn ? 'ONE_DATE' : kind;

  useEffect(() => {
    if (!tzOn) {
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
  }, [tzOn, date, time, tz]);

  function dayWord(localDate: string): string {
    const diff = Math.round(
      (keyToDate(localDate).getTime() - keyToDate(date).getTime()) / 86400000,
    );
    if (diff === 0) return '';
    return diff < 0 ? ' (днём раньше)' : ' (днём позже)';
  }

  async function handleSave() {
    setBusy(true);
    try {
      await saveExtraAlarm({
        id: alarm?.id ?? newId(),
        label: label.trim(),
        timeLocal: time,
        kind: effectiveKind,
        date: effectiveKind === 'ONE_DATE' ? date : null,
        enabled: alarm?.enabled ?? true,
        sourceTz: tzOn ? tz : null,
        leadMinutes: 0,
      });
      onDone();
    } catch (error) {
      Alert.alert('Не удалось сохранить будильник', String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!alarm) return;
    setBusy(true);
    try {
      await deleteExtraAlarm(alarm.id);
      onDone();
    } catch (error) {
      Alert.alert('Не удалось удалить будильник', String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={styles.title}>{alarm ? 'Будильник' : 'Новый будильник'}</Text>
      {fixedDate && (
        <Text style={styles.fixedHint}>
          {alarm && alarm.kind !== 'ONE_DATE'
            ? `Повторяется: ${KIND_LABELS[alarm.kind].toLowerCase()}. Изменение коснётся всех таких дней.`
            : formatKeyLong(alarm?.date ?? fixedDate)}
        </Text>
      )}

      {tzOn && <Text style={styles.fixedHint}>Время события в: {cityName(tz)}</Text>}
      <TimeStepper value={time} onChange={setTime} />

      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="Подпись (необязательно)"
        placeholderTextColor={colors.textSecondary}
        maxLength={40}
      />

      {(!fixedDate || !alarm || alarm.kind === 'ONE_DATE') && (
        <View style={styles.tzBlock}>
          <View style={styles.tzRow}>
            <Text style={styles.tzTitle}>Время в другом часовом поясе</Text>
            <Switch
              value={tzOn}
              onValueChange={v => {
                setTzOn(v);
                if (v) setKind('ONE_DATE');
              }}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>
          {tzOn && (
            <>
              <Pressable style={styles.cityBtn} onPress={() => setPickerOpen(o => !o)}>
                <Text style={styles.cityBtnText}>{cityName(tz)}</Text>
                <Text style={styles.cityBtnHint}>{pickerOpen ? 'скрыть' : 'сменить'}</Text>
              </Pressable>
              {pickerOpen && (
                <>
                  <TextInput
                    style={styles.input}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Поиск города"
                    placeholderTextColor={colors.textSecondary}
                  />
                  <ScrollView style={styles.cityList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {searchCities(query).map(c => (
                      <Pressable
                        key={c.tz}
                        style={[styles.cityItem, c.tz === tz && styles.cityItemActive]}
                        onPress={() => {
                          setTz(c.tz);
                          setPickerOpen(false);
                          setQuery('');
                        }}
                      >
                        <Text style={styles.cityItemText}>{c.ru}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              )}
              {preview && (
                <Text style={styles.tzPreview}>
                  {shortTime(time)} ({cityName(tz)}) → сработает в {shortTime(preview.timeLocal)} по твоему времени
                  {dayWord(preview.date)}
                </Text>
              )}
            </>
          )}
        </View>
      )}

      {!fixedDate && (
        <>
          <Text style={styles.sectionLabel}>Когда звонит</Text>
          {!tzOn && <KindPicker value={kind} onChange={setKind} />}
          {effectiveKind === 'ONE_DATE' && <DateStepper value={date} onChange={setDate} />}
        </>
      )}

      <Pressable style={[styles.primary, busy && styles.disabled]} onPress={handleSave} disabled={busy}>
        <Text style={styles.primaryText}>Сохранить</Text>
      </Pressable>
      {alarm && (
        <Pressable style={styles.dangerOutline} onPress={handleDelete} disabled={busy}>
          <Text style={styles.dangerText}>Удалить</Text>
        </Pressable>
      )}
      <Pressable style={styles.secondary} onPress={onCancel} disabled={busy}>
        <Text style={styles.secondaryText}>Отмена</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.headline, color: colors.textPrimary, textAlign: 'center' },
  fixedHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.caption, color: colors.textPrimary },
  chipTextActive: { color: colors.background, fontWeight: '600' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  dateBtn: {
    minWidth: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  dateBtnText: { ...typography.caption, color: colors.textPrimary },
  dateText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  tzBlock: { marginBottom: spacing.sm },
  tzRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  tzTitle: { ...typography.body, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  cityBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  cityBtnText: { ...typography.body, color: colors.textPrimary },
  cityBtnHint: { ...typography.caption, color: colors.textSecondary },
  cityList: { maxHeight: 180, marginBottom: spacing.md },
  cityItem: { paddingVertical: 10, paddingHorizontal: spacing.md, borderRadius: 10 },
  cityItemActive: { backgroundColor: colors.background },
  cityItemText: { ...typography.body, color: colors.textPrimary },
  tzPreview: { ...typography.caption, color: colors.accent, marginBottom: spacing.md },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryText: { ...typography.body, fontWeight: '600', color: colors.background },
  disabled: { opacity: 0.5 },
  secondary: { paddingVertical: spacing.md, alignItems: 'center' },
  secondaryText: { ...typography.body, color: colors.textSecondary },
  dangerText: { ...typography.body, fontWeight: '600', color: '#C0453A' },
  dangerOutline: {
    borderWidth: 1.5,
    borderColor: '#C0453A',
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
});
