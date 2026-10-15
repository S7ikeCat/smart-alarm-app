import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { TimeStepper } from './TimeStepper';
import { SelectRow } from './SelectRow';
import { TzCard } from './TzCard';
import { FormActions } from './FormActions';
import {
  ExtraAlarmKind,
  NativeExtraAlarm,
  saveExtraAlarm,
  deleteExtraAlarm,
} from '../native/alarmCore';
import { CITY_ZONES } from '../utils/timezones';
import {
  KIND_LABELS,
  addDaysToKey,
  dateToKey,
  formatKeyLong,
  newId,
} from '../utils/timeUtils';


const KINDS: ExtraAlarmKind[] = ['WORK_DAYS', 'REST_DAYS', 'ALL_DAYS', 'ONE_DATE'];

/** Выбор "когда звонит": строка, по нажатию — окошко со списком вариантов. */
export function KindPicker({
  value,
  onChange,
  tone = 'background',
}: {
  value: ExtraAlarmKind;
  onChange: (kind: ExtraAlarmKind) => void;
  tone?: 'surface' | 'background';
}) {
  return (
    <View style={{ marginBottom: tone === 'surface' ? 0 : spacing.md }}>
      <SelectRow
        title="Когда звонит"
        tone={tone}
        variant="dialog"
        value={value}
        onChange={onChange}
        options={KINDS.map(k => ({ value: k, label: KIND_LABELS[k] }))}
      />
    </View>
  );
}

/** Выбор даты кнопками: день назад/вперёд и неделя назад/вперёд. */
export function DateStepper({
  value,
  onChange,
  inGroup = false,
}: {
  value: string; // "YYYY-MM-DD"
  onChange: (value: string) => void;
  inGroup?: boolean;
}) {
  const btn = [styles.dateBtn, inGroup && { backgroundColor: colors.surface }];
  return (
    <View style={[styles.dateRow, inGroup && { marginBottom: 0 }]}>
      <Pressable style={btn} onPress={() => onChange(addDaysToKey(value, -7))}>
        <Text style={styles.dateBtnText}>−7</Text>
      </Pressable>
      <Pressable style={btn} onPress={() => onChange(addDaysToKey(value, -1))}>
        <ChevronLeft color={colors.textPrimary} size={20} />
      </Pressable>
      <Text style={styles.dateText}>{formatKeyLong(value)}</Text>
      <Pressable style={btn} onPress={() => onChange(addDaysToKey(value, 1))}>
        <ChevronRight color={colors.textPrimary} size={20} />
      </Pressable>
      <Pressable style={btn} onPress={() => onChange(addDaysToKey(value, 7))}>
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

  const effectiveKind: ExtraAlarmKind = kind;

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

      <TimeStepper value={time} onChange={setTime} />

      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="Подпись (необязательно)"
        placeholderTextColor={colors.textSecondary}
        maxLength={40}
      />

      {!fixedDate && (
        <View style={styles.group}>
          <KindPicker value={kind} onChange={setKind} tone="surface" />
          {effectiveKind === 'ONE_DATE' && <DateStepper value={date} onChange={setDate} inGroup />}
        </View>
      )}

      {(!fixedDate || !alarm || alarm.kind === 'ONE_DATE') && (
        <TzCard
          on={tzOn}
          onToggle={setTzOn}
          tz={tz}
          onTz={setTz}
          time={time}
          date={effectiveKind === 'ONE_DATE' ? date : dateToKey(new Date())}
        />
      )}

      <FormActions onSave={handleSave} onCancel={onCancel} onDelete={alarm ? handleDelete : undefined} busy={busy} />
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
  group: {
    backgroundColor: colors.background,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  lockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    opacity: 0.7,
  },
  lockedTitle: { ...typography.body, color: colors.textPrimary },
  lockedValue: { ...typography.body, color: colors.textSecondary },
  note: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  previewBox: {
    backgroundColor: 'rgba(232,135,90,0.12)',
    borderRadius: 12,
    padding: spacing.md,
  },
  tzRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
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
  tzPreview: { ...typography.body, color: colors.accent },
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
