import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronUp, ChevronDown } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { parseTime, makeTime, pad2 } from '../utils/timeUtils';

type Props = {
  value: string; // "HH:MM:SS"
  onChange: (value: string) => void;
};

const MINUTE_JUMPS = [-10, -5, 5, 10];

/** Выбор времени кнопками: часы ±1, минуты ±1 и быстрые прыжки ±5/±10. */
export function TimeStepper({ value, onChange }: Props) {
  const { h, m } = parseTime(value);

  const setHour = (next: number) => onChange(makeTime(((next % 24) + 24) % 24, m));
  const setMinute = (next: number) => onChange(makeTime(h, ((next % 60) + 60) % 60));

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.column}>
          <Pressable style={styles.arrow} onPress={() => setHour(h + 1)} hitSlop={8}>
            <ChevronUp color={colors.textPrimary} size={26} />
          </Pressable>
          <Text style={styles.digits}>{pad2(h)}</Text>
          <Pressable style={styles.arrow} onPress={() => setHour(h - 1)} hitSlop={8}>
            <ChevronDown color={colors.textPrimary} size={26} />
          </Pressable>
        </View>

        <Text style={styles.colon}>:</Text>

        <View style={styles.column}>
          <Pressable style={styles.arrow} onPress={() => setMinute(m + 1)} hitSlop={8}>
            <ChevronUp color={colors.textPrimary} size={26} />
          </Pressable>
          <Text style={styles.digits}>{pad2(m)}</Text>
          <Pressable style={styles.arrow} onPress={() => setMinute(m - 1)} hitSlop={8}>
            <ChevronDown color={colors.textPrimary} size={26} />
          </Pressable>
        </View>
      </View>

      <View style={styles.jumps}>
        {MINUTE_JUMPS.map(delta => (
          <Pressable key={delta} style={styles.jump} onPress={() => setMinute(m + delta)}>
            <Text style={styles.jumpText}>
              {delta > 0 ? `+${delta}` : `${delta}`} мин
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center' },
  column: { alignItems: 'center', width: 84 },
  arrow: {
    width: 56,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digits: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.textPrimary,
    marginVertical: 6,
  },
  colon: { fontSize: 44, fontWeight: '700', color: colors.textSecondary, marginHorizontal: 4 },
  jumps: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  jump: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: colors.background,
  },
  jumpText: { ...typography.caption, color: colors.textSecondary },
});
