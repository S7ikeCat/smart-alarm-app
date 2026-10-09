import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { TimeStepper } from './TimeStepper';
import { KindPicker, DateStepper } from './ExtraAlarmForm';
import { ExtraAlarmKind, saveExtraAlarm } from '../native/alarmCore';
import { addMinutesToTime, dateToKey, newId, shortTime } from '../utils/timeUtils';

function NumberStepper({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <View style={styles.numRow}>
      <Text style={styles.numLabel}>{label}</Text>
      <View style={styles.numControls}>
        <Pressable style={styles.numBtn} onPress={() => onChange(Math.max(min, value - 1))}>
          <Text style={styles.numBtnText}>−</Text>
        </Pressable>
        <Text style={styles.numValue}>
          {value} {suffix}
        </Text>
        <Pressable style={styles.numBtn} onPress={() => onChange(Math.min(max, value + 1))}>
          <Text style={styles.numBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

type Props = {
  onDone: () => void;
  onCancel: () => void;
};

/** "Серия": несколько будильников подряд с одинаковым шагом — для тех, кто встаёт не с первого раза. */
export function SeriesForm({ onDone, onCancel }: Props) {
  const [start, setStart] = useState('06:00:00');
  const [count, setCount] = useState(5);
  const [step, setStep] = useState(5);
  const [label, setLabel] = useState('Подъём');
  const [kind, setKind] = useState<ExtraAlarmKind>('ALL_DAYS');
  const [date, setDate] = useState(dateToKey(new Date()));
  const [busy, setBusy] = useState(false);

  const times = Array.from({ length: count }, (_, i) => addMinutesToTime(start, i * step));

  async function handleCreate() {
    setBusy(true);
    try {
      for (let i = 0; i < times.length; i++) {
        await saveExtraAlarm({
          id: newId(),
          label: `${label.trim() || 'Подъём'} ${i + 1}`,
          timeLocal: times[i],
          kind,
          date: kind === 'ONE_DATE' ? date : null,
          enabled: true,
        });
      }
      onDone();
    } catch (error) {
      Alert.alert('Не удалось создать серию', String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={styles.title}>Серия будильников</Text>
      <Text style={styles.hint}>Первый — в выбранное время, дальше с одинаковым шагом.</Text>

      <TimeStepper value={start} onChange={setStart} />

      <NumberStepper label="Сколько" value={count} min={2} max={10} suffix="шт." onChange={setCount} />
      <NumberStepper label="Шаг" value={step} min={1} max={30} suffix="мин" onChange={setStep} />

      <Text style={styles.preview}>{times.map(shortTime).join(' · ')}</Text>

      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="Название"
        placeholderTextColor={colors.textSecondary}
        maxLength={30}
      />

      <Text style={styles.sectionLabel}>Когда звонит</Text>
      <KindPicker value={kind} onChange={setKind} />
      {kind === 'ONE_DATE' && <DateStepper value={date} onChange={setDate} />}

      <Pressable style={[styles.primary, busy && styles.disabled]} onPress={handleCreate} disabled={busy}>
        <Text style={styles.primaryText}>Создать {count} будильников</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={onCancel} disabled={busy}>
        <Text style={styles.secondaryText}>Отмена</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.headline, color: colors.textPrimary, textAlign: 'center' },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: 4 },
  numRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  numLabel: { ...typography.body, color: colors.textPrimary },
  numControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  numBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numBtnText: { fontSize: 22, color: colors.textPrimary },
  numValue: { ...typography.body, color: colors.textPrimary, minWidth: 70, textAlign: 'center' },
  preview: {
    ...typography.caption,
    color: colors.accent,
    textAlign: 'center',
    marginVertical: spacing.md,
  },
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
});
