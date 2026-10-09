import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, Pressable, BackHandler, Alert, Animated } from 'react-native';
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
  loadSchedulePauses,
  loadExtraAlarms,
  generateExtraAlarms,
  loadAlarmTimeOverrides,
  NativeWorkSchedule,
  NativeAlarmInstance,
  NativeCustomEvent,
  NativeExtraAlarm,
  NativeExtraAlarmInstance,
  NativeAlarmTimeOverride,
} from '../../native/alarmCore';
import { DaySheet, DayDetails } from '../../components/DaySheet';
import { startOfDay, addDays, isDateInAnyPause } from '../../utils/scheduleCalendar';
import { syncSystemAlarms } from '../../native/alarmSync';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dateToKey } from '../../utils/timeUtils';
import { calendarChangeColor } from '../../theme/marks';
import { pruneTimeOverrides } from '../../utils/timeOverrides';

const DAYS_TO_SHOW = 7;
const ROW_GAP = spacing.sm;
const MIN_ROW_HEIGHT = 64;
const FAB_CLEARANCE = 72; // высота кнопки (56) + отступ, чтобы список не прятался под ней

type DayRow = {
  date: Date;
  isWorkDay: boolean; // рабочий день ПО ГРАФИКУ (диванчик живёт на остальных, даже если там есть будильник)
  hasAlarms: boolean; // в этот день хоть что-то зазвонит
  hasCalendarChanges: boolean; // день изменён через календарь: будильник на дату или другое время
  time: string | null; // самый ранний будильник дня
  alarmCount: number; // сколько всего будильников в этот день
  events: NativeCustomEvent[];
  details: DayDetails;
  isPaused: boolean;
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
  const [extraAlarms, setExtraAlarms] = useState<NativeExtraAlarm[]>([]);
  const [timeOverrides, setTimeOverrides] = useState<NativeAlarmTimeOverride[]>([]);
  const [sheetDateKey, setSheetDateKey] = useState<string | null>(null);

  // Показ/скрытие кнопки "+" по НАПРАВЛЕНИЮ скролла, а не по его позиции —
  // специально не завязываем прозрачность на сами пиксели прокрутки (это
  // дёргалось бы на слабых телефонах), только на факт "листаем вниз/вверх".
  // Состояние всегда бинарное: кнопка либо полностью видна, либо полностью
  // спрятана — быстрым, но не мгновенным движением между двумя состояниями.
  const fabAnim = useRef(new Animated.Value(1)).current;
// Само ЦЕЛЕВОЕ значение (0 или 1), к которому анимация сейчас стремится —
// а не флаг "видна ли она уже физически на экране".
const fabTargetRef = useRef(1);
const decisionAnchorYRef = useRef(0);
// Храним саму ЗАПУЩЕННУЮ анимацию (не Value, а объект от .start()), чтобы
// остановить её синхронно через .stop() — в отличие от Value.stopAnimation(),
// это не требует асинхронного колбэка с нативной стороны, который иногда
// вообще не вызывался при useNativeDriver, из-за чего кнопка немела насовсем.
const runningAnimationRef = useRef<{ stop: () => void } | null>(null);

function handleScroll(e: { nativeEvent: { contentOffset: { y: number } } }) {
  const currentY = e.nativeEvent.contentOffset.y;
  const distanceFromAnchor = currentY - decisionAnchorYRef.current;
  const THRESHOLD = 8;

  const shouldHide = distanceFromAnchor > THRESHOLD && fabTargetRef.current === 1;
  const shouldShow = distanceFromAnchor < -THRESHOLD && fabTargetRef.current === 0;

  if (shouldHide || shouldShow) {
    const nextTarget = shouldHide ? 0 : 1;
    fabTargetRef.current = nextTarget;
    decisionAnchorYRef.current = currentY;

    runningAnimationRef.current?.stop();

    const animation = Animated.timing(fabAnim, {
      toValue: nextTarget,
      duration: nextTarget === 0 ? 120 : 140,
      useNativeDriver: true,
    });
    runningAnimationRef.current = animation;
    animation.start();
  }
}
  const isSelectionMode = selectedEventIds.size > 0;

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadCalendarData = useCallback(async () => {
    const [schedules, alarms, events, extraList, extraInstances] = await Promise.all([
      loadWorkSchedules(),
      generateUpcomingAlarms(2),
      loadCustomEvents(),
      loadExtraAlarms(),
      generateExtraAlarms(2),
    ]);

    const active = schedules.find(s => s.isActive) ?? null;
    setActiveSchedule(active);
    setExtraAlarms(extraList);

    if (!active) {
      setDays([]);
      setTimeOverrides([]);
      return;
    }

    const [pauses, overrides] = await Promise.all([
      loadSchedulePauses(active.id),
      loadAlarmTimeOverrides(active.id),
    ]);
    const scheduleTimesByDate = new Map<string, string[]>();
    for (const instance of alarms as NativeAlarmInstance[]) {
      const list = scheduleTimesByDate.get(instance.date) ?? [];
      list.push(instance.timeLocal);
      scheduleTimesByDate.set(instance.date, list);
    }

    const extrasByDate = new Map<string, NativeExtraAlarmInstance[]>();
    for (const extra of extraInstances) {
      const list = extrasByDate.get(extra.date) ?? [];
      list.push(extra);
      extrasByDate.set(extra.date, list);
    }

    // Убираем "времена на дату", которые ничего не меняют или устарели
    // (совпали с обычным временем, день уже не рабочий, дата прошла) —
    // иначе голубая метка "изменено" зависала бы на пустом месте.
    const checkUntilKey = dateToKey(addDays(startOfDay(new Date()), 55));
    const cleanedOverrides = await pruneTimeOverrides(active, overrides, {
      workDates: new Set(scheduleTimesByDate.keys()),
      checkUntilKey,
    });
    setTimeOverrides(cleanedOverrides);

    const eventsByDate = new Map<string, NativeCustomEvent[]>();
    for (const event of events) {
      const list = eventsByDate.get(event.date) ?? [];
      list.push(event);
      eventsByDate.set(event.date, list);
    }

    const timeOverridesList = cleanedOverrides;
    // Метку "изменено через календарь" ставим только на разовые будильники и
    // смену времени на дату — повторяющиеся (на все выходные и т.п.) это
    // правило, а не правка конкретного дня, иначе метки залили бы весь список.
    const oneDateIds = new Set(extraList.filter(a => a.kind === 'ONE_DATE').map(a => a.id));

    const today = startOfDay(new Date());
    const rows: DayRow[] = [];

    for (let i = 0; i < DAYS_TO_SHOW; i++) {
      const day = addDays(today, i);
      const key = dateToKey(day);
      const scheduleTimes = scheduleTimesByDate.get(key) ?? [];
      const dayExtras = extrasByDate.get(key) ?? [];
      const dayEvents = eventsByDate.get(key) ?? [];

      // Все моменты, когда в этот день реально зазвонит телефон: смена,
      // дополнительные будильники и события с включённым напоминанием.
      const ringTimes = [
        ...scheduleTimes,
        ...dayExtras.map(e => e.timeLocal),
        ...dayEvents.filter(e => e.reminderEnabled).map(e => e.timeLocal),
      ].sort();

      rows.push({
        date: day,
        isWorkDay: scheduleTimes.length > 0,
        hasAlarms: ringTimes.length > 0,
        hasCalendarChanges:
          timeOverridesList.some(o => o.date === key) ||
          dayExtras.some(e => oneDateIds.has(e.alarmId)),
        time: ringTimes.length > 0 ? ringTimes[0].slice(0, 5) : null,
        alarmCount: ringTimes.length,
        events: dayEvents,
        details: {
          dateKey: key,
          hasScheduleAlarms: scheduleTimes.length > 0,
          extras: dayExtras,
          events: dayEvents,
        },
        isPaused: isDateInAnyPause(day, pauses),
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

      // Синхронизируем реальные системные будильники при каждом заходе на
      // экран — не мгновенно после каждого сохранения где-то ещё, но
      // достаточно надёжно: будильник всё равно далеко впереди по времени,
      // успеет актуализироваться, как только пользователь хоть раз откроет
      // Календарь. Намеренно не блокируем основной UI её результатом —
      // просто логируем ошибку, если что-то пошло не так.
      syncSystemAlarms().catch(error => console.log('Не удалось синхронизировать будильники:', error));

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

  function toggleRowSelection(row: DayRow) {
    const ids = row.events.map(e => e.id);
    setSelectedEventIds(prev => {
      const next = new Set(prev);
      const allSelected = ids.every(id => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  function handleLongPressRow(item: DayRow) {
    if (item.events.length === 0) return; // нечего выделять — на этот день нет события
    if (!isSelectionMode) {
      setSelectedEventIds(new Set(item.events.map(e => e.id)));
    }
  }

  function handlePressRow(item: DayRow) {
    if (isSelectionMode) {
      if (item.events.length > 0) toggleRowSelection(item);
      return;
    }
    // Обычный тап — шторка дня: время будильников, дополнительные, события.
    setSheetDateKey(item.details.dateKey);
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
      <AlarmClock
          color={todayRow?.isPaused ? colors.pauseAccent : colors.accent}
          size={26}
          style={styles.heroIcon}
        />
        <Text style={styles.greeting}>{getGreeting(new Date().getHours())}</Text>
        <Text style={styles.dateCaption}>{formatTodayDate(new Date())}</Text>

        {todayRow?.isWorkDay ? (
          <Text style={[styles.time, { fontSize: typography.displayLarge.fontSize * scale }]}>
            {formatClock(now)}
          </Text>
                ) : (
                  <>
                    <Sofa color={todayRow?.isPaused ? colors.pauseAccent : colors.restAccent} size={44} />
                    <Text style={styles.restHeroTitle}>Сегодня твой день</Text>
                  </>
                )}
        {/* Будильник выходного дня дописываем в уже существующую строку — шапка
            не становится выше, а значит высота списка ниже и размер строк не меняются. */}
        <Text style={styles.subtitle}>
          {activeSchedule.name}
          {!todayRow?.isWorkDay && todayRow?.hasAlarms && todayRow.time
            ? ` · будильник ${todayRow.time}${todayRow.alarmCount > 1 ? ` (×${todayRow.alarmCount})` : ''}`
            : ''}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Ближайшие дни</Text>

      <FlatList
        data={days}
        keyExtractor={item => dateKey(item.date)}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom }]}
        onLayout={e => setListAreaHeight(e.nativeEvent.layout.height)}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        renderItem={({ item }) => {
          const availableForRows = listAreaHeight - insets.bottom - FAB_CLEARANCE - ROW_GAP * (DAYS_TO_SHOW - 1);
          const rowHeight =
            listAreaHeight > 0
              ? Math.max(MIN_ROW_HEIGHT, Math.floor(availableForRows / DAYS_TO_SHOW))
              : MIN_ROW_HEIGHT;

          const isSelectable = item.events.length > 0;
          const isSelected = isSelectable && item.events.every(e => selectedEventIds.has(e.id));
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
                  !item.isWorkDay && styles.rowRest,
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
                  {item.events.map(ev => (
                    <View key={ev.id} style={[styles.eventDot, { backgroundColor: ev.color }]} />
                  ))}
                  <Text style={styles.rowDay}>{formatDayLabel(item.date, days[0].date)}</Text>
                  {item.hasCalendarChanges && <View style={styles.changeDot} />}
                </View>
                {item.isWorkDay ? (
                  <View style={styles.timeBox}>
                    {item.alarmCount > 1 && <Text style={styles.countBadge}>×{item.alarmCount}</Text>}
                    <Text style={styles.rowTime}>{item.time ?? '—'}</Text>
                  </View>
                ) : (
                  // Выходной остаётся выходным: диванчик на месте, а будильник,
                  // если он есть, — тихая подпись рядом, а не крупное время.
                  <View style={styles.timeBox}>
                    {item.hasAlarms && item.time && (
                      <Text style={styles.restAlarmTime}>
                        {item.alarmCount > 1 ? `×${item.alarmCount}  ` : ''}
                        {item.time}
                      </Text>
                    )}
                    <Sofa color={item.isPaused ? colors.pauseAccent : colors.restAccent} size={22} />
                  </View>
                )}
              </View>
            </Pressable>
          );
        }}
      />

<Animated.View
  style={[
    styles.fabWrapper,
    {
      opacity: fabAnim,
      transform: [
        {
          translateY: fabAnim.interpolate({
            inputRange: [0, 1],
            outputRange: [80, 0], // резко "падает" вниз за пределы экрана и пропадает
          }),
        },
      ],
    },
  ]}
  pointerEvents={fabTargetRef.current === 1 ? 'auto' : 'none'}
>
  {isSelectionMode ? (
    <Pressable style={[styles.fab, styles.fabDanger]} onPress={handleDeleteSelected}>
      <Trash2 color={colors.textPrimary} size={24} />
    </Pressable>
  ) : (
    <Pressable style={styles.fab} onPress={() => navigation.navigate('AddEvent')}>
      <Plus color={colors.background} size={26} />
    </Pressable>
  )}
</Animated.View>

      <DaySheet
        visible={sheetDateKey !== null}
        details={days.find(d => d.details.dateKey === sheetDateKey)?.details ?? null}
        schedule={activeSchedule}
        timeOverrides={timeOverrides}
        extraAlarms={extraAlarms}
        onClose={() => setSheetDateKey(null)}
        onChanged={() => {
          loadCalendarData().catch(error => console.log('Не удалось обновить календарь:', error));
        }}
        onOpenEvent={event => {
          setSheetDateKey(null);
          navigation.navigate('AddEvent', { existingEvent: event });
        }}
      />
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
  restAlarmTime: { ...typography.body, color: colors.textSecondary },
  changeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: calendarChangeColor },
  timeBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  countBadge: { ...typography.caption, color: colors.textSecondary },
  rowTime: {
    ...typography.headline,
    fontSize: 20,
    color: colors.textPrimary,
  },
  fabWrapper: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
  },
  fab: {
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