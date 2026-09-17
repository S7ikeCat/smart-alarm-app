import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Plus, Minus } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { SchedulesStackParamList } from '../../navigation/types';

type Navigation = NativeStackNavigationProp<SchedulesStackParamList, 'CustomPattern'>;

export function CustomPatternScreen() {
  const navigation = useNavigation<Navigation>();
  // Начинаем с недели выходных — пользователь сам расставляет рабочие дни.
  const [pattern, setPattern] = useState<boolean[]>(Array(7).fill(false));

  function toggleDay(index: number) {
    setPattern(prev => prev.map((isWork, i) => (i === index ? !isWork : isWork)));
  }

  function addDay() {
    if (pattern.length < 31) setPattern(prev => [...prev, false]);
  }

  function removeDay() {
    if (pattern.length > 1) setPattern(prev => prev.slice(0, -1));
  }

  const workCount = pattern.filter(Boolean).length;
  const canContinue = workCount > 0 && workCount < pattern.length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>
        Нажимай на дни, чтобы отметить рабочие — цикл потом повторится
      </Text>

      <View style={styles.daysWrap}>
        {pattern.map((isWork, i) => (
          <Pressable
            key={i}
            style={[styles.dayTile, isWork && styles.dayTileWork]}
            onPress={() => toggleDay(i)}
          >
            <Text style={[styles.dayTileNumber, isWork && styles.dayTileNumberWork]}>
              {i + 1}
            </Text>
            <Text style={[styles.dayTileLabel, isWork && styles.dayTileLabelWork]}>
              {isWork ? 'Раб' : 'Вых'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.lengthRow}>
        <Pressable
          style={[styles.lengthButton, pattern.length <= 1 && styles.lengthButtonDisabled]}
          disabled={pattern.length <= 1}
          onPress={removeDay}
        >
          <Minus color={pattern.length <= 1 ? colors.border : colors.textPrimary} size={20} />
        </Pressable>
        <Text style={styles.lengthLabel}>{pattern.length} дн. в цикле</Text>
        <Pressable
          style={[styles.lengthButton, pattern.length >= 31 && styles.lengthButtonDisabled]}
          disabled={pattern.length >= 31}
          onPress={addDay}
        >
          <Plus color={pattern.length >= 31 ? colors.border : colors.textPrimary} size={20} />
        </Pressable>
      </View>

      <Text style={styles.summary}>
        {workCount} раб. / {pattern.length - workCount} вых. за {pattern.length} дн.
      </Text>

      <Pressable
        style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
        disabled={!canContinue}
        onPress={() =>
          navigation.navigate('ConfigureSchedule', {
            presetId: 'custom',
            presetName: 'Свой график',
            pattern,
          })
        }
      >
        <Text style={styles.continueButtonText}>Продолжить</Text>
      </Pressable>

      {!canContinue && (
        <Text style={styles.hint}>
          Нужен хотя бы один рабочий и один выходной день
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  sectionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  daysWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dayTile: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayTileWork: { backgroundColor: colors.accent },
  dayTileNumber: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
  dayTileNumberWork: { color: colors.background },
  dayTileLabel: { ...typography.caption, fontSize: 11, color: colors.textSecondary },
  dayTileLabelWork: { color: colors.background },
  lengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginTop: spacing.xl,
  },
  lengthButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lengthButtonDisabled: { opacity: 0.3 },
  lengthLabel: { ...typography.body, color: colors.textPrimary },
  summary: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  continueButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  continueButtonDisabled: { opacity: 0.4 },
  continueButtonText: { ...typography.body, fontWeight: '600', color: colors.background },
  hint: {
    ...typography.caption,
    color: colors.accent,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});