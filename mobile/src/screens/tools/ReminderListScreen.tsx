import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, SectionList, Alert } from 'react-native';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Circle, CircleCheck, Flag, BellRing, Repeat, Plus } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { ToolsStackParamList } from '../../navigation/types';
import {
  loadCustomEvents,
  loadReminderLists,
  saveCustomEvent,
  completeReminder,
  NativeCustomEvent,
  NativeReminderList,
} from '../../native/alarmCore';
import { dateToKey, shortTime } from '../../utils/timeUtils';
import { filterSmart, groupByDate, dateLabel, REPEAT_LABELS, sortByDateTime } from '../../utils/reminders';

type Nav = NativeStackNavigationProp<ToolsStackParamList, 'ReminderList'>;
type Route = RouteProp<ToolsStackParamList, 'ReminderList'>;

export function ReminderListScreen() {
  const navigation = useNavigation<Nav>();
  const { filter, listId } = useRoute<Route>().params;
  const [events, setEvents] = useState<NativeCustomEvent[]>([]);
  const [lists, setLists] = useState<NativeReminderList[]>([]);

  const refresh = useCallback(() => {
    loadCustomEvents().then(setEvents).catch(() => {});
    loadReminderLists().then(setLists).catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const todayKey = dateToKey(new Date());

  const open = filter
    ? filterSmart(events, filter, todayKey)
    : events.filter(e => e.listId === listId && !e.completed);
  const done = filter ? [] : sortByDateTime(events.filter(e => e.listId === listId && e.completed));

  const sections = groupByDate(open).map(g => ({ title: dateLabel(g.date, todayKey), data: g.items }));
  if (done.length > 0) sections.push({ title: 'Завершено', data: done });

  async function toggleDone(e: NativeCustomEvent) {
    try {
      if (e.completed) await saveCustomEvent({ ...e, completed: false });
      else await completeReminder(e.id, e.date);
      refresh();
    } catch (error) {
      Alert.alert('Не удалось обновить напоминание', String(error));
    }
  }

  function listColor(e: NativeCustomEvent) {
    return lists.find(l => l.id === e.listId)?.color ?? e.color;
  }

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={e => e.id}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={<Text style={styles.empty}>Здесь пока пусто.</Text>}
        renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => navigation.navigate('AddEvent', { existingEvent: item })}>
            <Pressable onPress={() => toggleDone(item)} hitSlop={10}>
              {item.completed ? (
                <CircleCheck color={colors.accentSecondary} size={26} />
              ) : (
                <Circle color={listColor(item)} size={26} />
              )}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, item.completed && styles.labelDone]} numberOfLines={2}>
                {item.label}
              </Text>
              <Text style={styles.meta}>
                {item.date !== todayKey && filter ? `${dateLabel(item.date, todayKey)}, ` : ''}
                {item.reminderEnabled ? shortTime(item.timeLocal) : 'без времени'}
                {item.repeat && item.repeat !== 'ONCE' ? `  ·  ${REPEAT_LABELS[item.repeat]}` : ''}
              </Text>
            </View>
            {item.repeat && item.repeat !== 'ONCE' && <Repeat color={colors.textSecondary} size={16} />}
            {item.urgent && item.reminderEnabled && <BellRing color="#D64541" size={18} />}
            {item.flagged && <Flag color="#E8A33D" size={18} fill="#E8A33D" />}
          </Pressable>
        )}
      />
      <Pressable
        style={styles.fab}
        onPress={() => navigation.navigate('AddEvent', listId ? { listId } : undefined)}
      >
        <Plus color={colors.background} size={20} />
        <Text style={styles.fabText}>Новое напоминание</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 110 },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textTransform: 'capitalize',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  label: { ...typography.body, color: colors.textPrimary },
  labelDone: { color: colors.textSecondary, textDecorationLine: 'line-through' },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  fab: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: spacing.md,
  },
  fabText: { ...typography.body, fontWeight: '600', color: colors.background },
});
