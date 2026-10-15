import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import {
  Calendar as CalendarIcon,
  Bell,
  BellOff,
  BellRing,
  Flag,
  Repeat,
  ListTodo,
} from 'lucide-react-native';
import uuid from 'react-native-uuid';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { CalendarStackParamList } from '../../navigation/types';
import {
  saveCustomEvent,
  deleteCustomEvent,
  loadReminderLists,
  NativeReminderList,
  ReminderRepeat,
} from '../../native/alarmCore';
import { SelectRow } from '../../components/SelectRow';
import { TimeField } from '../../components/TimeField';
import { requestNotificationPermission } from '../../native/permissions';
import { REPEAT_LABELS, REPEAT_OPTIONS, DEFAULT_REMINDER_COLOR } from '../../utils/reminders';

type Navigation = NativeStackNavigationProp<CalendarStackParamList, 'AddEvent'>;
type Route = RouteProp<CalendarStackParamList, 'AddEvent'>;

const DESCRIPTION_LIMIT = 700;

function formatDate(date: Date) {
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}

function dateKeyOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseIso(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function AddEventScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<Route>();
  const existingEvent = route.params?.existingEvent;
  const isEditing = existingEvent !== undefined;
  const fromSchedule = route.params?.fromSchedule === true;

  // Закрыть экран. Если пришли из настроек графика — вернуть туда же,
  // а не оставлять человека на вкладке «Календарь».
  function finish() {
    navigation.goBack();
    if (fromSchedule) {
      navigation.getParent()?.navigate('Schedules' as never);
    }
  }

  const [label, setLabel] = useState(existingEvent?.label ?? '');
  const [description, setDescription] = useState(existingEvent?.description ?? '');
  const [reminderEnabled, setReminderEnabled] = useState(existingEvent?.reminderEnabled ?? true);
  const [urgent, setUrgent] = useState(existingEvent?.urgent ?? false);
  const [flagged, setFlagged] = useState(existingEvent?.flagged ?? false);
  const [repeat, setRepeat] = useState<ReminderRepeat>(existingEvent?.repeat ?? 'ONCE');
  const [listId, setListId] = useState<string | null>(existingEvent?.listId ?? route.params?.listId ?? null);
  const [lists, setLists] = useState<NativeReminderList[]>([]);
  const [date, setDate] = useState(() =>
    existingEvent
      ? parseIso(existingEvent.date)
      : route.params?.date
        ? parseIso(route.params.date)
        : new Date(),
  );
  const [time, setTime] = useState(() => {
    if (existingEvent) {
      const [h, m] = existingEvent.timeLocal.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d;
    }
    const d = new Date();
    d.setHours(8, 0, 0, 0);
    return d;
  });
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  useEffect(() => {
    loadReminderLists().then(setLists).catch(() => {});
  }, []);

  const canSave = label.trim().length > 0;

  async function handleSave() {
    const dateStr = dateKeyOf(date);
    const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:00`;

    try {
      if (reminderEnabled && !urgent) await requestNotificationPermission();
      const listColor = lists.find(l => l.id === listId)?.color;
      await saveCustomEvent({
        id: existingEvent?.id ?? (uuid.v4() as string),
        date: dateStr,
        timeLocal: timeStr,
        color: listColor ?? DEFAULT_REMINDER_COLOR,
        label: label.trim(),
        description: description.trim(),
        reminderEnabled,
        urgent,
        flagged,
        repeat,
        listId,
        completed: existingEvent?.completed ?? false,
      });
      finish();
    } catch (error) {
      Alert.alert('Не удалось сохранить напоминание', String(error));
    }
  }

  function handleDelete() {
    if (!existingEvent) return;
    Alert.alert('Удалить напоминание?', `«${existingEvent.label}» будет удалено безвозвратно.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCustomEvent(existingEvent.id);
            finish();
          } catch (error) {
            Alert.alert('Не удалось удалить событие', String(error));
          }
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionLabel}>Что напомнить</Text>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="Например: позвонить маме"
        placeholderTextColor={colors.textSecondary}
      />

      <Text style={styles.sectionLabel}>Описание (необязательно)</Text>
      <TextInput
        style={[styles.input, styles.descriptionInput]}
        value={description}
        onChangeText={text => setDescription(text.slice(0, DESCRIPTION_LIMIT))}
        placeholder="Например: купить торт, шарики, подарок"
        placeholderTextColor={colors.textSecondary}
        multiline
        maxLength={DESCRIPTION_LIMIT}
      />
      <Text style={styles.charCounter}>
        {description.length}/{DESCRIPTION_LIMIT}
      </Text>

      <Text style={styles.sectionLabel}>Дата</Text>
      <Pressable style={styles.row} onPress={() => setIsDatePickerOpen(true)}>
        <CalendarIcon color={colors.textSecondary} size={20} />
        <Text style={styles.rowValue}>{formatDate(date)}</Text>
      </Pressable>

      {isDatePickerOpen && (
        <DateTimePicker
          value={date}
          mode="date"
          onValueChange={(event, selected) => {
            setIsDatePickerOpen(false);
            if (selected) setDate(selected);
          }}
          onDismiss={() => setIsDatePickerOpen(false)}
        />
      )}

      <Text style={styles.sectionLabel}>Время</Text>
      <Pressable style={styles.reminderRow} onPress={() => setReminderEnabled(prev => !prev)}>
        {reminderEnabled ? (
          <Bell color={colors.accent} size={20} />
        ) : (
          <BellOff color={colors.textSecondary} size={20} />
        )}
        <View style={styles.reminderTextBlock}>
          <Text style={styles.reminderTitle}>Напомнить в указанное время</Text>
          <Text style={styles.reminderHint}>
            {reminderEnabled ? 'Сработает уведомлением' : 'Просто заметка в календаре, без сигнала'}
          </Text>
        </View>
        <View style={[styles.toggle, reminderEnabled && styles.toggleOn]}>
          <View style={[styles.toggleThumb, reminderEnabled && styles.toggleThumbOn]} />
        </View>
      </Pressable>

      <View style={{ marginTop: spacing.sm }}>
        <TimeField
          value={`${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:00`}
          onChange={v => {
            const [h, m] = v.split(':').map(Number);
            const d = new Date();
            d.setHours(h, m, 0, 0);
            setTime(d);
          }}
          title="Время напоминания"
          disabled={!reminderEnabled}
        />
      </View>

      {reminderEnabled && (
        <Pressable style={[styles.reminderRow, { marginTop: spacing.sm }]} onPress={() => setUrgent(prev => !prev)}>
          <BellRing color={urgent ? colors.accent : colors.textSecondary} size={20} />
          <View style={styles.reminderTextBlock}>
            <Text style={styles.reminderTitle}>Срочное</Text>
            <Text style={styles.reminderHint}>
              {urgent ? 'Зазвонит как будильник' : 'Обычное уведомление'}
            </Text>
          </View>
          <View style={[styles.toggle, urgent && styles.toggleOn]}>
            <View style={[styles.toggleThumb, urgent && styles.toggleThumbOn]} />
          </View>
        </Pressable>
      )}

      <Pressable style={[styles.reminderRow, { marginTop: spacing.sm }]} onPress={() => setFlagged(prev => !prev)}>
        <Flag color={flagged ? '#E8A33D' : colors.textSecondary} size={20} />
        <View style={styles.reminderTextBlock}>
          <Text style={styles.reminderTitle}>Флажок</Text>
          <Text style={styles.reminderHint}>Попадёт в список «С флажком»</Text>
        </View>
        <View style={[styles.toggle, flagged && styles.toggleOn]}>
          <View style={[styles.toggleThumb, flagged && styles.toggleThumbOn]} />
        </View>
      </Pressable>

      <View style={styles.pickCard}>
        <SelectRow
          title="Повтор"
          icon={<Repeat color={repeat === 'ONCE' ? colors.textSecondary : colors.accent} size={20} />}
          value={repeat}
          onChange={setRepeat}
          options={REPEAT_OPTIONS.map(r => ({ value: r, label: REPEAT_LABELS[r] }))}
        />
        <SelectRow
          title="Список"
          icon={<ListTodo color={colors.textSecondary} size={20} />}
          value={listId}
          onChange={setListId}
          options={[
            { value: null as string | null, label: 'Без списка', color: colors.border },
            ...lists.map(l => ({ value: l.id as string | null, label: l.name, color: l.color })),
          ]}
          footnote={lists.length === 0 ? 'Списков пока нет. Создай их в Инструменты → Напоминания.' : undefined}
        />
      </View>

      <Pressable
        style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
        disabled={!canSave}
        onPress={handleSave}
      >
        <Text style={styles.saveButtonText}>
          {isEditing ? 'Сохранить изменения' : 'Сохранить'}
        </Text>
      </Pressable>

      {isEditing && (
        <Pressable style={styles.deleteButton} onPress={handleDelete}>
          <Text style={styles.deleteButtonText}>Удалить напоминание</Text>
        </Pressable>
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
  descriptionInput: { minHeight: 100, textAlignVertical: 'top' },
  charCounter: { ...typography.caption, color: colors.textSecondary, textAlign: 'right', marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
  },
  rowValue: { ...typography.body, color: colors.textPrimary, textTransform: 'capitalize' },
  rowDisabled: { opacity: 0.4 },
  rowValueDisabled: { color: colors.textSecondary },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  reminderTextBlock: { flex: 1 },
  reminderTitle: { ...typography.body, color: colors.textPrimary },
  reminderHint: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  toggle: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.border,
    padding: 2,
    justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.textPrimary },
  toggleThumbOn: { alignSelf: 'flex-end' },
  pickCard: { gap: spacing.sm, marginTop: spacing.lg },
  chipDot: { width: 10, height: 10, borderRadius: 5 },
  saveButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { ...typography.body, fontWeight: '600', color: colors.background },
  deleteButton: { marginTop: spacing.md, paddingVertical: spacing.md, alignItems: 'center' },
  deleteButtonText: { ...typography.body, color: '#C0453A' },
});