import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { Clock } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { SchedulesStackParamList } from '../../navigation/types';

import { Alert } from 'react-native'; // добавь Alert в существующий импорт из 'react-native'
import { saveWorkSchedule, NativeWorkSchedule } from '../../native/alarmCore';

import uuid from 'react-native-uuid';

type Route = RouteProp<SchedulesStackParamList, 'ConfigureSchedule'>;
type Navigation = NativeStackNavigationProp<SchedulesStackParamList, 'ConfigureSchedule'>;

const SCHEDULE_COLORS = ['#E8875A', '#4A7A6B', '#C0453A', '#6B8CAE', '#B08AC7'];
const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Готовые варианты "за сколько до смены будить" — один тап вместо возни с пикером.
const OFFSET_OPTIONS = [15, 30, 45, 60, 90, 120];

type DayOverride = 'work' | 'rest';
type GridCell = { date: Date; inCurrentMonth: boolean };

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function isWorkDayByPattern(date: Date, startDate: Date, pattern: boolean[]) {
  const cycleLen = pattern.length;
  const diffDays = Math.floor(
    (startOfDay(date).getTime() - startOfDay(startDate).getTime()) / 86400000,
  );
  if (diffDays < 0) return false;
  const dayInCycle = diffDays % cycleLen;
  return pattern[dayInCycle];
}

function chunkIntoWeeks(cells: GridCell[]): GridCell[][] {
  const weeks: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/**
 * Строит сетку месяца с ISO-неделями (Пн...Вс). Дополняет ведущие и
 * замыкающие ячейки днями соседних месяцев (приглушённые, некликабельные),
 * чтобы сетка всегда была ровной — без пустых "дыр".
 */
function buildMonthGrid(monthDate: Date): GridCell[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // JS getDay(): Вс=0, Пн=1, ..., Сб=6. Переводим так, чтобы Пн=0 ... Вс=6.
  const firstWeekdayIndex = (firstDayOfMonth.getDay() + 6) % 7;

  const grid: GridCell[] = [];

  for (let i = firstWeekdayIndex - 1; i >= 0; i--) {
    grid.push({ date: new Date(year, month - 1, daysInPrevMonth - i), inCurrentMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    grid.push({ date: new Date(year, month, d), inCurrentMonth: true });
  }

  while (grid.length % 7 !== 0) {
    const lastDate = grid[grid.length - 1].date;
    grid.push({ date: addDays(lastDate, 1), inCurrentMonth: false });
  }

  return grid;
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function formatMonth(date: Date) {
  return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function formatStartLabel(date: Date) {
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Время подъёма = время смены минус offset. Может уехать на предыдущие сутки — это нормально. */
function alarmTimeFor(shiftTime: Date, offsetMinutes: number) {
  return new Date(shiftTime.getTime() - offsetMinutes * 60000);
}

function formatOffset(minutes: number) {
  if (minutes < 60) return `${minutes} мин`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} ч` : `${Math.floor(hours)} ч ${minutes % 60} мин`;
}

export function ConfigureScheduleScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { presetId, presetName, pattern } = route.params;

  const [name, setName] = useState(presetName);
  const [selectedColor, setSelectedColor] = useState(SCHEDULE_COLORS[0]);
  const [visibleMonth, setVisibleMonth] = useState(new Date());
  const [overrides, setOverrides] = useState<Record<string, DayOverride>>({});

  // Время начала смены. По умолчанию 08:00 — типичное начало дневной смены.
  const [shiftTime, setShiftTime] = useState(() => {
    const d = new Date();
    d.setHours(8, 0, 0, 0);
    return d;
  });
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // За сколько минут до смены будить. Можно несколько — "за 2 часа" + "за 30 минут".
  const [alarmOffsets, setAlarmOffsets] = useState<number[]>([30]);

  // По умолчанию выравниваем цикл так, чтобы первый день паттерна попал на
  // понедельник — это то, чего ждёт большинство (обычная пятидневка Пн-Пт).
  // Стрелки остаются для тех, у кого график сдвинут (5/2 с началом в субботу и т.п.).
  const [startOffset, setStartOffset] = useState(() => {
    const todayWeekday = (new Date().getDay() + 6) % 7; // Пн=0 ... Вс=6
    const daysUntilMonday = (7 - todayWeekday) % 7;
    return daysUntilMonday % pattern.length;
  });

  const startDate = useMemo(() => startOfDay(addDays(new Date(), startOffset)), [startOffset]);
  const monthWeeks = useMemo(() => chunkIntoWeeks(buildMonthGrid(visibleMonth)), [visibleMonth]);

  function dateKey(d: Date) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function toggleOffset(minutes: number) {
    setAlarmOffsets(prev =>
      prev.includes(minutes)
        ? prev.filter(m => m !== minutes)
        : [...prev, minutes].sort((a, b) => b - a),
    );
  }

  function handleDayTap(day: Date) {
    const key = dateKey(day);
    const patternIsWork = isWorkDayByPattern(day, startDate, pattern);
    setOverrides(prev => {
      const next = { ...prev };
      const current = next[key];
      if (current === undefined) {
        next[key] = patternIsWork ? 'rest' : 'work';
      } else if (current === (patternIsWork ? 'rest' : 'work')) {
        delete next[key];
      }
      return next;
    });
  }

  async function handleSave() {
    const nativeSchedule: NativeWorkSchedule = {
      id: uuid.v4() as string,
      name,
      color: selectedColor,
      pattern,
      sourcePresetId: presetId === 'custom' ? null : presetId,
      startDate: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`,
      shiftStartTime: `${String(shiftTime.getHours()).padStart(2, '0')}:${String(shiftTime.getMinutes()).padStart(2, '0')}:00`,
      alarms: alarmOffsets.map(offsetMinutes => ({
        id: uuid.v4() as string,
        offsetMinutes,
        ringtoneId: 'default',
        vibration: true,
      })),
      isActive: true,
      isPaused: false,
    };
  
    try {
      await saveWorkSchedule(nativeSchedule);
      navigation.popToTop();
    } catch (error) {
      Alert.alert('Не удалось сохранить график', String(error));
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>Название</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.sectionLabel}>Цвет</Text>
      <View style={styles.colorRow}>
        {SCHEDULE_COLORS.map(color => (
          <Pressable
            key={color}
            style={[
              styles.colorSwatch,
              { backgroundColor: color },
              selectedColor === color && styles.colorSwatchSelected,
            ]}
            onPress={() => setSelectedColor(color)}
          />
        ))}
      </View>

      <Text style={styles.sectionLabel}>Начало смены</Text>
      <Pressable style={styles.timeRow} onPress={() => setIsPickerOpen(true)}>
  <Clock color={colors.textSecondary} size={20} />
  <Text style={styles.timeValue}>{formatTime(shiftTime)}</Text>
  <Text style={styles.timeHint}>изменить</Text>
</Pressable>

      {isPickerOpen && (
  <DateTimePicker
    value={shiftTime}
    mode="time"
    is24Hour
    onValueChange={(event, selected) => {
      setIsPickerOpen(false);
      if (selected) {
        setShiftTime(selected);
      }
    }}
    onDismiss={() => setIsPickerOpen(false)}
  />
)}

      <Text style={styles.sectionLabel}>Будить до смены</Text>
      <View style={styles.offsetsWrap}>
        {OFFSET_OPTIONS.map(minutes => {
          const isSelected = alarmOffsets.includes(minutes);
          return (
            <Pressable
              key={minutes}
              style={[styles.offsetChip, isSelected && styles.offsetChipSelected]}
              onPress={() => toggleOffset(minutes)}
            >
              <Text style={[styles.offsetChipText, isSelected && styles.offsetChipTextSelected]}>
                {formatOffset(minutes)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {alarmOffsets.length > 0 ? (
        <View style={styles.alarmPreview}>
          {alarmOffsets.map(minutes => (
            <View key={minutes} style={styles.alarmPreviewRow}>
              <Text style={styles.alarmPreviewTime}>
                {formatTime(alarmTimeFor(shiftTime, minutes))}
              </Text>
              <Text style={styles.alarmPreviewLabel}>за {formatOffset(minutes)} до смены</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.emptyAlarmsHint}>Выбери хотя бы один будильник</Text>
      )}

      <Text style={styles.sectionLabel}>Начать цикл с</Text>
      <View style={styles.stepperRow}>
        <Pressable
          style={[styles.stepperArrow, startOffset <= 0 && styles.stepperArrowDisabled]}
          disabled={startOffset <= 0}
          onPress={() => setStartOffset(o => o - 1)}
        >
          <ChevronLeft color={startOffset <= 0 ? colors.border : colors.textPrimary} size={22} />
        </Pressable>

        <View style={styles.stepperLabelBlock}>
          <Text style={styles.stepperLabel}>{formatStartLabel(startDate)}</Text>
          <Text style={styles.stepperHint}>
            сдвиг {startOffset + 1} из {pattern.length}
          </Text>
        </View>

        <Pressable
          style={[
            styles.stepperArrow,
            startOffset >= pattern.length - 1 && styles.stepperArrowDisabled,
          ]}
          disabled={startOffset >= pattern.length - 1}
          onPress={() => setStartOffset(o => o + 1)}
        >
          <ChevronRight
            color={startOffset >= pattern.length - 1 ? colors.border : colors.textPrimary}
            size={22}
          />
        </Pressable>
      </View>

      <Text style={styles.sectionLabel}>Календарь — нажми на день, чтобы изменить</Text>
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
                const key = dateKey(day);
                const override = overrides[key];
                const patternIsWork = isWorkDayByPattern(day, startDate, pattern);
                const effectiveIsWork = override ? override === 'work' : patternIsWork;
                const isStart = isSameDay(day, startDate);
                const hasOverride = override !== undefined;

                return (
                  <Pressable
                    key={i}
                    style={styles.dayCell}
                    disabled={!inCurrentMonth}
                    onPress={() => handleDayTap(day)}
                  >
                    <View
                      style={[
                        styles.dayCircle,
                        inCurrentMonth && effectiveIsWork && styles.dayCircleWork,
                        inCurrentMonth && isStart && styles.dayCircleStart,
                        inCurrentMonth && hasOverride && styles.dayCircleOverride,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayNumber,
                          !inCurrentMonth && styles.dayNumberMuted,
                          inCurrentMonth && effectiveIsWork && styles.dayNumberWork,
                        ]}
                      >
                        {day.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
            <Text style={styles.legendText}>Рабочий</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.legendDotOverride]} />
            <Text style={styles.legendText}>Изменено вручную</Text>
          </View>
        </View>
      </View>

      <Pressable
        style={[styles.saveButton, alarmOffsets.length === 0 && styles.saveButtonDisabled]}
        disabled={alarmOffsets.length === 0}
        onPress={handleSave}
      >
        <Text style={styles.saveButtonText}>Сохранить график</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  sectionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
  },
  colorRow: { flexDirection: 'row', gap: spacing.sm },
  colorSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  colorSwatchSelected: { borderColor: colors.textPrimary },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
  },
  timeValue: { ...typography.headline, fontSize: 22, color: colors.textPrimary, flex: 1 },
  timeHint: { ...typography.caption, color: colors.accent },
  offsetsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  offsetChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  offsetChipSelected: { backgroundColor: colors.accent },
  offsetChipText: { ...typography.caption, color: colors.textSecondary },
  offsetChipTextSelected: { color: colors.background, fontWeight: '600' },
  alarmPreview: { marginTop: spacing.md, gap: spacing.sm },
  alarmPreviewRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  alarmPreviewTime: { ...typography.headline, fontSize: 20, color: colors.textPrimary },
  alarmPreviewLabel: { ...typography.caption, color: colors.textSecondary },
  emptyAlarmsHint: { ...typography.caption, color: colors.accent, marginTop: spacing.md },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: spacing.sm,
  },
  stepperArrow: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  stepperArrowDisabled: { opacity: 0.3 },
  stepperLabelBlock: { flex: 1, alignItems: 'center' },
  stepperLabel: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  stepperHint: { ...typography.caption, fontSize: 11, color: colors.textSecondary, marginTop: 2 },
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
  dayCircleStart: { borderWidth: 2, borderColor: colors.textPrimary },
  dayCircleOverride: { borderWidth: 2, borderColor: colors.accentSecondary },
  dayNumber: { ...typography.caption, color: colors.textSecondary },
  dayNumberMuted: { color: colors.border },
  dayNumberWork: { color: colors.background, fontWeight: '600' },
  legendRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendDotOverride: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.accentSecondary,
  },
  legendText: { ...typography.caption, color: colors.textSecondary },
  saveButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { ...typography.body, fontWeight: '600', color: colors.background },
});