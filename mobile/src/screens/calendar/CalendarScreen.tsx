import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, BackHandler, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CalendarStackParamList } from '../../navigation/types';
import { Sofa, AlarmClock, Plus, Trash2, Check } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, useResponsiveScale } from '../../theme/spacing';
import {
  loadWorkSchedules,
  generateUpcomingAlarms,
  loadCustomEvents,
  deleteCustomEvent,
  NativeWorkSchedule,
  NativeAlarmInstance,
  NativeCustomEvent,
} from '../../native/alarmCore';
import { startOfDay, addDays } from '../../utils/scheduleCalendar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DAYS_TO_SHOW = 7;
const ROW_GAP = spacing.sm;
const MIN_ROW_HEIGHT = 64;

type DayRow = {
  date: Date;
  isWork: boolean;
  time: string | null;
  event: NativeCustomEvent | null;
};

function dateKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function formatDayLabel(date: Date, today: Date) {
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Завтра';
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function getGreeting(hour: number) {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

function formatTodayDate(date: Date) {
  const formatted = date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatClock(date: Date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

type Navigation = NativeStackNavigationProp<CalendarStackParamList, 'CalendarMain'>;

export function CalendarScreen() {
  const navigation = useNavigation<Navigation>();
  const scale = useResponsiveScale();
  const insets = useSafeAreaInsets();
  const [activeSchedule, setActiveSchedule] = useState<NativeWorkSchedule | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listAreaHeight, setListAreaHeight] = useState(0);
  const [now, setNow] = useState(new Date());
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const isSelectionMode = selectedEventIds.size > 0;

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadCalendarData = useCallback(async () => {
    const [schedules, alarms, events] = await Promise.all([
      loadWorkSchedules(),
      generateUpcomingAlarms(2),
      loadCustomEvents(),
    ]);

    const active = schedules.find(s => s.isActive) ?? null;
    setActiveSchedule(active);

    if (!active) {
      setDays([]);
      return;
    }

    const earliestByDate = new Map<string, NativeAlarmInstance>();
    for (const instance of alarms) {
      const key = instance.date;
      const existing = earliestByDate.get(key);
      if (!existing || instance.timeLocal < existing.timeLocal) {
        earliestByDate.set(key, instance);
      }
    }

    const eventByDate = new Map<string, NativeCustomEvent>();
    for (const event of events) {
      eventByDate.set(event.date, event);
    }

    const today = startOfDay(new Date());
    const rows: DayRow[] = [];

    for (let i = 0; i < DAYS_TO_SHOW; i++) {
      const day = addDays(today, i);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      const matchedAlarm = earliestByDate.get(key);
      const matchedEvent = eventByDate.get(key) ?? null;

      // "Симбиоз": если день рабочий — время смены остаётся главным (событие
      // видно точкой рядом). Если день выходной, но есть событие со своим
      // напоминанием — показываем ВРЕМЯ СОБЫТИЯ вместо пустого диванчика,
      // а не два раздельных "числа" для одного и того же дня.
      const eventHasReminder = matchedEvent?.reminderEnabled ?? false;
      const isWork = matchedAlarm !== undefined || (matchedEvent !== null && eventHasReminder);
      const time = matchedAlarm
        ? matchedAlarm.timeLocal.slice(0, 5)
        : matchedEvent && eventHasReminder
        ? matchedEvent.timeLocal.slice(0, 5)
        : null;

      rows.push({
        date: day,
        isWork,
        time,
        event: matchedEvent,
      });
    }

    setDays(rows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setIsLoading(true);

      loadCalendarData()
        .catch(error => console.log('Не удалось загрузить календарь:', error))
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }, [loadCalendarData]),
  );

  // Кнопка "назад" сначала снимает выделение событий, а не сразу уводит
  // с экрана — тот же паттерн, что и на экране "Графики".
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (isSelectionMode) {
          setSelectedEventIds(new Set());
          return true;
        }
        return false;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [isSelectionMode]),
  );

  function toggleEventSelection(id: string) {
    setSelectedEventIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleLongPressRow(item: DayRow) {
    if (!item.event) return; // нечего выделять — на этот день нет события
    if (!isSelectionMode) {
      setSelectedEventIds(new Set([item.event.id]));
    }
  }

  function handlePressRow(item: DayRow) {
    if (!item.event) return; // строки без события не реагируют на тап вообще
    if (isSelectionMode) {
      toggleEventSelection(item.event.id);
    } else {
      navigation.navigate('AddEvent', { existingEvent: item.event });
    }
  }

  async function handleDeleteSelected() {
    const idsToDelete = Array.from(selectedEventIds);
    try {
      await Promise.all(idsToDelete.map(id => deleteCustomEvent(id)));
      setSelectedEventIds(new Set());
      await loadCalendarData();
    } catch (error) {
      Alert.alert('Не удалось удалить события', String(error));
    }
  }

  if (isLoading && !activeSchedule) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!activeSchedule) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyText}>Нет активного графика</Text>
        <Text style={styles.emptyHint}>Выбери график во вкладке «Графики»</Text>
      </View>
    );
  }

  const todayRow = days[0];

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <AlarmClock color={colors.accent} size={26} style={styles.heroIcon} />
        <Text style={styles.greeting}>{getGreeting(new Date().getHours())}</Text>
        <Text style={styles.dateCaption}>{formatTodayDate(new Date())}</Text>

        {todayRow?.isWork ? (
          <Text style={[styles.time, { fontSize: typography.displayLarge.fontSize * scale }]}>
            {formatClock(now)}
          </Text>
        ) : (
          <>
            <Sofa color={colors.restAccent} size={44} />
            <Text style={styles.restHeroTitle}>Сегодня твой день</Text>
          </>
        )}
        <Text style={styles.subtitle}>{activeSchedule.name}</Text>
      </View>

      <Text style={styles.sectionTitle}>Ближайшие дни</Text>

      <FlatList
        data={days}
        keyExtractor={item => dateKey(item.date)}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom }]}
        onLayout={e => setListAreaHeight(e.nativeEvent.layout.height)}
        renderItem={({ item }) => {
          const availableForRows = listAreaHeight - insets.bottom - ROW_GAP * (DAYS_TO_SHOW - 1);
          const rowHeight =
            listAreaHeight > 0
              ? Math.max(MIN_ROW_HEIGHT, Math.floor(availableForRows / DAYS_TO_SHOW))
              : MIN_ROW_HEIGHT;

          const isSelectable = item.event !== null;
          const isSelected = item.event ? selectedEventIds.has(item.event.id) : false;
          // В режиме выбора строки без события визуально "выключены" —
          // сразу видно, что их нельзя выделить, удалять там нечего.
          const isDimmedForSelection = isSelectionMode && !isSelectable;

          return (
            <Pressable
              onLongPress={() => handleLongPressRow(item)}
              onPress={() => handlePressRow(item)}
              disabled={isSelectionMode && !isSelectable}
            >
              <View
                style={[
                  styles.row,
                  !item.isWork && styles.rowRest,
                  { height: rowHeight },
                  isSelected && styles.rowSelected,
                  isDimmedForSelection && styles.rowDimmed,
                ]}
              >
                <View style={styles.rowLeft}>
                  {isSelectionMode && isSelectable && (
                    <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                      {isSelected && <Check color={colors.background} size={14} />}
                    </View>
                  )}
                  {item.event && (
                    <View style={[styles.eventDot, { backgroundColor: item.event.color }]} />
                  )}
                  <Text style={styles.rowDay}>{formatDayLabel(item.date, days[0].date)}</Text>
                </View>
                {item.isWork ? (
                  <Text style={styles.rowTime}>{item.time ?? '—'}</Text>
                ) : (
                  <Sofa color={colors.restAccent} size={22} />
                )}
              </View>
            </Pressable>
          );
        }}
      />

      {isSelectionMode ? (
        <Pressable style={[styles.fab, styles.fabDanger]} onPress={handleDeleteSelected}>
          <Trash2 color={colors.textPrimary} size={24} />
        </Pressable>
      ) : (
        <Pressable style={styles.fab} onPress={() => navigation.navigate('AddEvent')}>
          <Plus color={colors.background} size={26} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: { justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  emptyText: { ...typography.body, color: colors.textPrimary, marginBottom: spacing.sm },
  emptyHint: { ...typography.caption, color: colors.textSecondary },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xl * 1.8,
    paddingBottom: spacing.lg,
  },
  heroIcon: {
    marginBottom: spacing.sm,
  },
  greeting: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  dateCaption: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  time: {
    fontWeight: typography.displayLarge.fontWeight,
    color: colors.textPrimary,
  },
  restHeroTitle: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 6.5,
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
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowRest: {
    opacity: 0.85,
  },
  rowSelected: {
    borderColor: colors.accent,
  },
  rowDimmed: {
    opacity: 0.3,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  eventDot: { width: 8, height: 8, borderRadius: 4 },
  rowDay: {
    ...typography.body,
    color: colors.textPrimary,
  },
  rowTime: {
    ...typography.headline,
    fontSize: 20,
    color: colors.textPrimary,
  },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabDanger: { backgroundColor: '#C0453A' },
});