import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
} from '../native/alarmCore';
import {
  KIND_LABELS,
  addDaysToKey,
  dateToKey,
  formatKeyLong,
  newId,
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

  async function handleSave() {
    setBusy(true);
    try {
      await saveExtraAlarm({
        id: alarm?.id ?? newId(),
        label: label.trim(),
        timeLocal: time,
        kind,
        date: kind === 'ONE_DATE' ? date : null,
        enabled: alarm?.enabled ?? true,
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
        <>
          <Text style={styles.sectionLabel}>Когда звонит</Text>
          <KindPicker value={kind} onChange={setKind} />
          {kind === 'ONE_DATE' && <DateStepper value={date} onChange={setDate} />}
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
