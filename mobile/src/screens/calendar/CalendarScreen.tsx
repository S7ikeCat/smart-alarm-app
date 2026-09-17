import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, useResponsiveScale } from '../../theme/spacing';

type UpcomingAlarm = {
  id: string;
  dayLabel: string; // "Завтра", "Пт, 6 марта"
  time: string;
  scheduleName: string;
};

// Заглушечные данные — позже заменятся реальными AlarmInstance из Rust-ядра
const MOCK_UPCOMING: UpcomingAlarm[] = [
  { id: '1', dayLabel: 'Завтра', time: '06:30', scheduleName: 'Основная работа' },
  { id: '2', dayLabel: 'Пт, 6 марта', time: '06:30', scheduleName: 'Основная работа' },
  { id: '3', dayLabel: 'Сб, 7 марта', time: '—', scheduleName: 'Выходной' },
];

export function CalendarScreen() {
  const scale = useResponsiveScale();

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.label}>Сегодня</Text>
        <Text style={[styles.time, { fontSize: typography.displayLarge.fontSize * scale }]}>
          06:30
        </Text>
        <Text style={styles.subtitle}>Рабочая смена</Text>
      </View>

      <Text style={styles.sectionTitle}>Ближайшие</Text>

      <FlatList
        data={MOCK_UPCOMING}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={styles.rowDay}>{item.dayLabel}</Text>
              <Text style={styles.rowSchedule}>{item.scheduleName}</Text>
            </View>
            <Text style={styles.rowTime}>{item.time}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  hero: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  time: {
    fontWeight: typography.displayLarge.fontWeight,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.accent,
    marginTop: spacing.sm,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowDay: {
    ...typography.body,
    color: colors.textPrimary,
  },
  rowSchedule: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rowTime: {
    ...typography.headline,
    fontSize: 20,
    color: colors.textPrimary,
  },
});