import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Clock } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { BottomSheet } from './BottomSheet';
import { TimeStepper } from './TimeStepper';
import { shortTime } from '../utils/timeUtils';

type Props = {
  value: string; // "HH:MM:SS"
  onChange: (value: string) => void;
  title?: string;
  disabled?: boolean;
};

/** Строка со временем; по нажатию — шторка с нашим выбором времени (как у нового будильника). */
export function TimeField({ value, onChange, title = 'Время', disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  function openSheet() {
    setDraft(value);
    setOpen(true);
  }

  return (
    <>
      <Pressable style={[styles.row, disabled && { opacity: 0.4 }]} onPress={openSheet} disabled={disabled}>
        <Clock color={colors.textSecondary} size={20} />
        <Text style={styles.value}>{shortTime(value)}</Text>
        <Text style={styles.hint}>изменить</Text>
      </Pressable>
      <BottomSheet visible={open} onClose={() => setOpen(false)}>
        <Text style={styles.title}>{title}</Text>
        <TimeStepper value={draft} onChange={setDraft} />
        <Pressable
          style={styles.done}
          onPress={() => {
            onChange(draft);
            setOpen(false);
          }}
        >
          <Text style={styles.doneText}>Готово</Text>
        </Pressable>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
  },
  value: { ...typography.body, color: colors.textPrimary, flex: 1 },
  hint: { ...typography.caption, color: colors.accent },
  title: { ...typography.headline, color: colors.textPrimary },
  done: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  doneText: { ...typography.body, fontWeight: '600', color: colors.background },
});
