import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Sofa, AlarmClock } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing, useResponsiveScale } from '../../theme/spacing';
import { loadWorkSchedules, generateUpcomingAlarms, NativeWorkSchedule, NativeAlarmInstance } from '../../native/alarmCore';
import { isWorkDayByPattern, startOfDay, addDays } from '../../utils/scheduleCalendar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const DAYS_TO_SHOW = 7;
const ROW_GAP = spacing.sm;
const MIN_ROW_HEIGHT = 64;

type DayRow = {
  date: Date;
  isWork: boolean;
  time: string | null;
};

function dateKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function parseIsoDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
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

export function CalendarScreen() {
  const scale = useResponsiveScale();
  const insets = useSafeAreaInsets();
  const [activeSchedule, setActiveSchedule] = useState<NativeWorkSchedule | null>(null);
  const [days, setDays] = useState<DayRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listAreaHeight, setListAreaHeight] = useState(0);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setIsLoading(true);

      async function load() {
        const [schedules, alarms] = await Promise.all([
          loadWorkSchedules(),
          generateUpcomingAlarms(2),
        ]);
        if (cancelled) return;

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

        const scheduleStart = parseIsoDate(active.startDate);
        const today = startOfDay(new Date());
        const rows: DayRow[] = [];

        for (let i = 0; i < DAYS_TO_SHOW; i++) {
          const day = addDays(today, i);
          const isWork = isWorkDayByPattern(day, scheduleStart, active.pattern);
          const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
          const matchedAlarm = earliestByDate.get(key);

          rows.push({
            date: day,
            isWork,
            time: matchedAlarm ? matchedAlarm.timeLocal.slice(0, 5) : null,
          });
        }

        setDays(rows);
      }

      load().finally(() => {
        if (!cancelled) setIsLoading(false);
      });

      return () => {
        cancelled = true;
      };
    }, []),
  );

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

          return (
            <View style={[styles.row, !item.isWork && styles.rowRest, { height: rowHeight }]}>
              <Text style={styles.rowDay}>{formatDayLabel(item.date, days[0].date)}</Text>
              {item.isWork ? (
                <Text style={styles.rowTime}>{item.time ?? '—'}</Text>
              ) : (
                <Sofa color={colors.restAccent} size={22} />
        )}
      </View>
    );
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
  },
  rowRest: {
    opacity: 0.85,
  },
  rowDay: {
    ...typography.body,
    color: colors.textPrimary,
  },
  rowTime: {
    ...typography.headline,
    fontSize: 20,
    color: colors.textPrimary,
  },
});