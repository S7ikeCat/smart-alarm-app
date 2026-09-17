import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pencil } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { SchedulesStackParamList } from '../../navigation/types';

type Preset = {
  id: string;
  name: string;
  pattern: boolean[]; // true = рабочий день
};

const PRESETS: Preset[] = [
  { id: 'cycle_2_2', name: '2 через 2', pattern: [true, true, false, false] },
  { id: 'cycle_5_2', name: '5 через 2', pattern: [true, true, true, true, true, false, false] },
  {
    // "График Питмана" — реальный 14-дневный цикл, а не просто 2 числа
    id: 'cycle_2_2_3',
    name: '2/2/3',
    pattern: [
      true, true, false, false, true, true, true, false, false, true, true, false, false, false,
    ],
  },
  { id: 'cycle_3_3', name: '3 через 3', pattern: [true, true, true, false, false, false] },
  {
    id: 'cycle_15_15',
    name: 'Вахта 15/15',
    pattern: [...Array(15).fill(true), ...Array(15).fill(false)],
  },
];

function patternLabel(pattern: boolean[]) {
  const workCount = pattern.filter(Boolean).length;
  const restCount = pattern.length - workCount;
  return `${workCount} раб. / ${restCount} вых. за ${pattern.length} дн.`;
}

function CyclePreview({ pattern }: { pattern: boolean[] }) {
  const dots = pattern.slice(0, 14); // ограничиваем показ, чтобы не растягивать карточку

  return (
    <View style={styles.dotsRow}>
      {dots.map((isWork, i) => (
        <View
          key={i}
          style={[styles.dot, { backgroundColor: isWork ? colors.accent : colors.border }]}
        />
      ))}
    </View>
  );
}

type Navigation = NativeStackNavigationProp<SchedulesStackParamList, 'CreateSchedule'>;

export function CreateScheduleScreen() {
  const navigation = useNavigation<Navigation>();

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.list}>
        {PRESETS.map(preset => (
          <View key={preset.id} style={styles.card}>
            <View style={styles.cardTextBlock}>
              <Text style={styles.cardName}>{preset.name}</Text>
              <Text style={styles.cardDetail}>{patternLabel(preset.pattern)}</Text>
              <CyclePreview pattern={preset.pattern} />
            </View>
            <Pressable
              style={styles.editButton}
              onPress={() =>
                navigation.navigate('ConfigureSchedule', {
                  presetId: preset.id,
                  presetName: preset.name,
                  pattern: preset.pattern,
                })
              }
            >
              <Pencil color={colors.background} size={18} />
            </Pressable>
          </View>
        ))}

        <Pressable
          style={[styles.card, styles.customCard]}
          onPress={() => navigation.navigate('CustomPattern')}
        >
          <View style={styles.cardTextBlock}>
            <Text style={styles.cardName}>Свой график</Text>
            <Text style={styles.cardDetail}>Настроить дни вручную</Text>
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  customCard: { marginTop: spacing.sm },
  cardTextBlock: { flex: 1, marginRight: spacing.md },
  cardName: { ...typography.body, color: colors.textPrimary, marginBottom: 2 },
  cardDetail: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  dotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
});