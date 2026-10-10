import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar as CalendarIcon, Clock, Bell, BellOff } from 'lucide-react-native';
import uuid from 'react-native-uuid';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { CalendarStackParamList } from '../../navigation/types';
import { saveCustomEvent, loadCustomEvents, deleteCustomEvent, NativeCustomEvent } from '../../native/alarmCore';

type Navigation = NativeStackNavigationProp<CalendarStackParamList, 'AddEvent'>;
type Route = RouteProp<CalendarStackParamList, 'AddEvent'>;

const EVENT_COLORS = ['#B08AC7', '#E8875A', '#4A7A6B', '#C0453A', '#6B8CAE'];
const DESCRIPTION_LIMIT = 700;

function formatDate(date: Date) {
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
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
  const [selectedColor, setSelectedColor] = useState(existingEvent?.color ?? EVENT_COLORS[0]);
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
  const [isTimePickerOpen, setIsTimePickerOpen] = useState(false);
  const [allEvents, setAllEvents] = useState<NativeCustomEvent[]>([]);
  
// Подгружаем список всех событий один раз — нужен, чтобы проверять,
// не занята ли выбранная дата уже другим событием.
useEffect(() => {
  loadCustomEvents().then(setAllEvents);
}, []);

// Проверяем дефолтную дату сразу после загрузки списка событий — раньше
// проверка срабатывала только когда пользователь САМ открывал календарь
// и явно выбирал дату. Если дата ни разу не менялась (осталась "сегодня"
// по умолчанию), а на сегодня уже есть событие — конфликт незаметно
// проходил мимо, и получалось два события на одну дату разом.
useEffect(() => {
  if (isEditing || allEvents.length === 0) return;

  const key = dateKeyOf(date);
  const conflicting = allEvents.find(ev => ev.date === key);
  if (conflicting) {
    Alert.alert(
      'На эту дату уже есть событие',
      `«${conflicting.label}» — открыть его для редактирования?`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Открыть существующее',
          onPress: () => navigation.setParams({ existingEvent: conflicting }),
        },
      ],
    );
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [allEvents]);
  
  // useState-инициализатор срабатывает только при первом рендере — когда
  // existingEvent меняется ПОЗЖЕ через navigation.setParams (пользователь
  // выбрал "Открыть существующее" при конфликте дат, оставаясь на этом же
  // экране), поля сами не обновятся без явного эффекта здесь.
  useEffect(() => {
    if (!existingEvent) return;
  
    setLabel(existingEvent.label);
    setDescription(existingEvent.description);
    setReminderEnabled(existingEvent.reminderEnabled);
    setSelectedColor(existingEvent.color);
    setDate(parseIso(existingEvent.date));
  
    const [h, m] = existingEvent.timeLocal.split(':').map(Number);
    const t = new Date();
    t.setHours(h, m, 0, 0);
    setTime(t);
   // eslint-disable-next-line react-hooks/exhaustive-deps
}, [existingEvent?.id]);

  const canSave = label.trim().length > 0;

  function handlePickDate(selected: Date) {
    const key = dateKeyOf(selected);
    const conflicting = allEvents.find(
      ev => ev.date === key && ev.id !== existingEvent?.id,
    );

    if (conflicting) {
      Alert.alert(
        'На эту дату уже есть событие',
        `«${conflicting.label}» — открыть его для редактирования?`,
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Открыть существующее',
            onPress: () => navigation.setParams({ existingEvent: conflicting }),
          },
        ],
      );
      return;
    }

    setDate(selected);
  }

  async function handleSave() {
    const dateStr = dateKeyOf(date);
    const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:00`;

    try {
      await saveCustomEvent({
        id: existingEvent?.id ?? (uuid.v4() as string),
        date: dateStr,
        timeLocal: timeStr,
        color: selectedColor,
        label: label.trim(),
        description: description.trim(),
        reminderEnabled,
      });
      finish();
    } catch (error) {
      Alert.alert('Не удалось сохранить событие', String(error));
    }
  }

  function handleDelete() {
    if (!existingEvent) return;
    Alert.alert('Удалить событие?', `«${existingEvent.label}» будет удалено безвозвратно.`, [
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
      <Text style={styles.sectionLabel}>Что за событие</Text>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="Например: день рождения дочки"
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
            if (selected) handlePickDate(selected);
          }}
          onDismiss={() => setIsDatePickerOpen(false)}
        />
      )}

      <Pressable style={styles.reminderRow} onPress={() => setReminderEnabled(prev => !prev)}>
        {reminderEnabled ? (
          <Bell color={colors.accent} size={20} />
        ) : (
          <BellOff color={colors.textSecondary} size={20} />
        )}
        <View style={styles.reminderTextBlock}>
          <Text style={styles.reminderTitle}>Напоминание</Text>
          <Text style={styles.reminderHint}>
            {reminderEnabled ? 'Сработает в указанное время' : 'Останется просто заметкой в календаре'}
          </Text>
        </View>
        <View style={[styles.toggle, reminderEnabled && styles.toggleOn]}>
          <View style={[styles.toggleThumb, reminderEnabled && styles.toggleThumbOn]} />
        </View>
      </Pressable>

      <Text style={styles.sectionLabel}>Время</Text>
      <Pressable
        style={[styles.row, !reminderEnabled && styles.rowDisabled]}
        onPress={() => setIsTimePickerOpen(true)}
        disabled={!reminderEnabled}
      >
        <Clock color={reminderEnabled ? colors.textSecondary : colors.border} size={20} />
        <Text style={[styles.rowValue, !reminderEnabled && styles.rowValueDisabled]}>
          {formatTime(time)}
        </Text>
      </Pressable>

      {isTimePickerOpen && (
        <DateTimePicker
          value={time}
          mode="time"
          is24Hour
          onValueChange={(event, selected) => {
            setIsTimePickerOpen(false);
            if (selected) setTime(selected);
          }}
          onDismiss={() => setIsTimePickerOpen(false)}
        />
      )}

      <Text style={styles.sectionLabel}>Цвет</Text>
      <View style={styles.colorRow}>
        {EVENT_COLORS.map(color => (
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
          <Text style={styles.deleteButtonText}>Удалить событие</Text>
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
  colorRow: { flexDirection: 'row', gap: spacing.sm },
  colorSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: 'transparent' },
  colorSwatchSelected: { borderColor: colors.textPrimary },
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