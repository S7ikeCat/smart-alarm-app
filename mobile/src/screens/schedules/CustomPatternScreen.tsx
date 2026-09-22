import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Plus, Minus, ChevronLeft, ChevronRight } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { SchedulesStackParamList } from '../../navigation/types';
import {
  isSameDay,
  startOfDay,
  isWorkDayByPattern,
  chunkIntoWeeks,
  buildMonthGrid,
  addMonths,
  formatMonth,
  WEEKDAY_LABELS,
} from '../../utils/scheduleCalendar';

type Navigation = NativeStackNavigationProp<SchedulesStackParamList, 'CustomPattern'>;

const today = startOfDay(new Date());

export function CustomPatternScreen() {
  const navigation = useNavigation<Navigation>();
  const [pattern, setPattern] = useState<boolean[]>(Array(7).fill(false));
  const [visibleMonth, setVisibleMonth] = useState(new Date());

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
  const restCount = pattern.length - workCount;
  const canContinue = workCount > 0 && restCount > 0;

  const hint =
    workCount === 0
      ? 'Отметь хотя бы один рабочий день'
      : restCount === 0
      ? 'Нужен хотя бы один выходной день'
      : '';

  // Живой предпросмотр — как паттерн ляжет на реальные даты, если начать
  // сегодня. Настоящую дату старта пользователь выберет позже, на экране
  // настройки графика — здесь только чтобы дать почувствовать цикл на месте
  // абстрактных цифр 1..N.
  const monthWeeks = useMemo(() => chunkIntoWeeks(buildMonthGrid(visibleMonth)), [visibleMonth]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
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

        <Text style={styles.sectionLabel}>Как это будет выглядеть, если начать сегодня</Text>
        <View style={styles.calendarCard}>
          <View style={styles.calendarHeader}>
            <Pressable onPress={() => setVisibleMonth(addMonths(visibleMonth, -1))}>
              <ChevronLeft color={colors.textSecondary} size={22} />
            </Pressable>
            <Text style={styles.calendarMonthLabel}>{formatMonth(visibleMonth)}</Text>
            <Pressable onPress={() => setVisibleMonth(addMonths(visibleMonth, 1))}>
              <ChevronRight color={colors.textSecondary} size={22} />
            </Pressable>
          </View>

          <View style={styles.weekdaysRow}>
            {WEEKDAY_LABELS.map(label => (
              <Text key={label} style={styles.weekdayLabel}>
                {label}
              </Text>
            ))}
          </View>

          <View>
            {monthWeeks.map((week, weekIndex) => (
              <View key={weekIndex} style={styles.weekRow}>
                {week.map((cell, i) => {
                  const { date: day, inCurrentMonth } = cell;
                  const isWork = isWorkDayByPattern(day, today, pattern);
                  const isToday = isSameDay(day, today);

                  return (
                    <View key={i} style={styles.dayCell}>
                      <View
                        style={[
                          styles.dayCircle,
                          inCurrentMonth && isWork && styles.dayCircleWork,
                          inCurrentMonth && isToday && styles.dayCircleToday,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayNumber,
                            !inCurrentMonth && styles.dayNumberMuted,
                            inCurrentMonth && isWork && styles.dayNumberWork,
                          ]}
                        >
                          {day.getDate()}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.lengthRow}>
          <Pressable
            style={[styles.lengthButton, pattern.length <= 1 && styles.lengthButtonDisabled]}
            disabled={pattern.length <= 1}
            onPress={removeDay}
          >
            <Minus color={pattern.length <= 1 ? colors.border : colors.textPrimary} size={22} />
          </Pressable>
          <View style={styles.lengthLabelBlock}>
            <Text style={styles.lengthLabel}>{pattern.length} дн. в цикле</Text>
            <Text style={styles.summary}>
              {workCount} раб. / {restCount} вых.
            </Text>
          </View>
          <Pressable
            style={[styles.lengthButton, pattern.length >= 31 && styles.lengthButtonDisabled]}
            disabled={pattern.length >= 31}
            onPress={addDay}
          >
            <Plus color={pattern.length >= 31 ? colors.border : colors.textPrimary} size={22} />
          </Pressable>
        </View>

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

        <Text style={[styles.hint, !hint && styles.hintHidden]}>{hint || ' '}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.lg },
  sectionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  daysWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
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
  calendarCard: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md },
  calendarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  calendarMonthLabel: { ...typography.body, color: colors.textPrimary, textTransform: 'capitalize' },
  weekdaysRow: { flexDirection: 'row' },
  weekdayLabel: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: 'center' },
  weekRow: { flexDirection: 'row' },
  dayCell: { flex: 1, aspectRatio: 1, justifyContent: 'center', alignItems: 'center' },
  dayCircle: {
    width: '78%',
    height: '78%',
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCircleWork: { backgroundColor: colors.accent },
  dayCircleToday: { borderWidth: 2, borderColor: colors.textPrimary },
  dayNumber: { ...typography.caption, color: colors.textSecondary },
  dayNumberMuted: { color: colors.border },
  dayNumberWork: { color: colors.background, fontWeight: '600' },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  lengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  lengthButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lengthButtonDisabled: { opacity: 0.3 },
  lengthLabelBlock: { alignItems: 'center', minWidth: 140 },
  lengthLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  summary: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  continueButton: {
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
  hintHidden: { opacity: 0 },
});