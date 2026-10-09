import React, { useState, useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Alert, Modal } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ChevronLeft, ChevronRight, Clock, Plus, Trash2, Check, X, CalendarRange } from 'lucide-react-native';
import uuid from 'react-native-uuid';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { SchedulesStackParamList } from '../../navigation/types';
import { calendarChangeColor } from '../../theme/marks';
import {
  saveWorkSchedule,
  saveDayOverrides,
  loadDayOverrides,
  saveSchedulePause,
  loadSchedulePauses,
  deleteSchedulePause,
  loadAlarmTimeOverrides,
  loadExtraAlarms,
  generateExtraAlarms,
  NativeWorkSchedule,
  NativeSchedulePause,
} from '../../native/alarmCore';

type Route = RouteProp<SchedulesStackParamList, 'ConfigureSchedule'>;
type Navigation = NativeStackNavigationProp<SchedulesStackParamList, 'ConfigureSchedule'>;

const SCHEDULE_COLORS = ['#E8875A', '#4A7A6B', '#C0453A', '#6B8CAE', '#B08AC7'];

type DayOverride = 'work' | 'rest';

import {
  isSameDay,
  startOfDay,
  addDays,
  isWorkDayByPattern,
  chunkIntoWeeks,
  buildMonthGrid,
  addMonths,
  formatMonth,
  WEEKDAY_LABELS,
  isDateInAnyPause,
} from '../../utils/scheduleCalendar';

function formatStartLabel(date: Date) {
  return date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Время, в которое реально звонит будильник графика, "HH:MM". В новой модели
 * оно хранится прямо в shiftStartTime (offset = 0). Для графиков, сохранённых
 * по-старому (смена минус N минут), пересчитываем, чтобы экран показывал то
 * время, в которое будильник действительно звонит.
 */
function ringTimeOf(schedule: NativeWorkSchedule): string {
  const [h, m] = schedule.shiftStartTime.split(':').map(Number);
  const offset = schedule.alarms[0]?.offsetMinutes ?? 0;
  const total = (((h * 60 + m - offset) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function serializeOverrides(o: Record<string, DayOverride>) {
  return JSON.stringify(Object.keys(o).sort().map(key => [key, o[key]]));
}

function formatIsoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function eachDateInRange(start: Date, end: Date): Date[] {
  const result: Date[] = [];
  let cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor.getTime() <= last.getTime()) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}


export function ConfigureScheduleScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const { presetId, presetName, pattern, existingSchedule } = route.params;
  const isEditing = existingSchedule !== undefined;

  const [name, setName] = useState(existingSchedule?.name ?? presetName);
  const [selectedColor, setSelectedColor] = useState(
    existingSchedule?.color ?? SCHEDULE_COLORS[0],
  );
  const [visibleMonth, setVisibleMonth] = useState(new Date());
  const [overrides, setOverrides] = useState<Record<string, DayOverride>>({});

  // При редактировании существующего графика подгружаем его сохранённые
  // overrides — до этого момента экран не знал о них ничего, начинал с пустого.
  useEffect(() => {
    if (!existingSchedule) return;

    loadDayOverrides(existingSchedule.id).then(loaded => {
      const asRecord: Record<string, DayOverride> = {};
      for (const o of loaded) {
        const [year, month, day] = o.date.split('-').map(Number);
        const key = `${year}-${month}-${day}`;
        asRecord[key] = o.isWork ? 'work' : 'rest';
      }
      setOverrides(asRecord);

      // Overrides подгружаются асинхронно, уже после того как initialSignatureRef
      // зафиксировал снимок "на момент открытия" (тогда overrides ещё были {}).
      // Обновляем снимок сейчас, чтобы дальнейшее сравнение hasChanges было
      // честным относительно реально загруженных overrides, а не пустоты.
      initialSignatureRef.current = JSON.stringify({
        name: existingSchedule.name,
        color: existingSchedule.color,
        shiftStartTime: ringTimeOf(existingSchedule),
        overrides: serializeOverrides(asRecord),
        startOffset: initialStartOffsetRef.current,
      });
    });
  }, [existingSchedule]);

  // --- Паузы (отпуск/больничный на диапазон дат) ---------------------------

  const [pauses, setPauses] = useState<NativeSchedulePause[]>([]);
  const [isPauseSelectMode, setIsPauseSelectMode] = useState(false);
  const [pauseAnchor, setPauseAnchor] = useState<Date | null>(null);
  const [pauseCursor, setPauseCursor] = useState<Date | null>(null);
  const [pauseLabel, setPauseLabel] = useState('');
  const [isPauseFormOpen, setIsPauseFormOpen] = useState(false);
  const [isCustomPauseLabel, setIsCustomPauseLabel] = useState(false);

  const PAUSE_LABEL_PRESETS = ['Отпуск', 'Больничный'];

  // Пауза возможна только у УЖЕ сохранённого графика — schedule_pauses
  // ссылается на реальный id графика в БД, которого у нового графика
  // (ещё не нажали "Сохранить") физически не существует.
  useEffect(() => {
    if (!existingSchedule) return;
    loadSchedulePauses(existingSchedule.id).then(setPauses);
  }, [existingSchedule]);

  // Дни, изменённые через вкладки "Календарь"/"Будильники": разовый будильник
  // на дату или другое время будильника на этот день. Показываем голубой
  // меткой, чтобы выходной с будильником не выглядел как ошибка графика.
  // Повторяющиеся будильники (на все выходные) сюда намеренно не входят —
  // это правило, а не правка конкретного дня.
  const [calendarMarks, setCalendarMarks] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!existingSchedule) return;
    const toKey = (iso: string) => {
      const [y, m, d] = iso.split('-').map(Number);
      return `${y}-${m}-${d}`;
    };
    Promise.all([
      loadAlarmTimeOverrides(existingSchedule.id),
      loadExtraAlarms(),
      generateExtraAlarms(12),
    ])
      .then(([timeOverrides, extras, instances]) => {
        const marks = new Set<string>();
        for (const t of timeOverrides) marks.add(toKey(t.date));
        const oneDateIds = new Set(extras.filter(a => a.kind === 'ONE_DATE').map(a => a.id));
        for (const i of instances) {
          if (oneDateIds.has(i.alarmId)) marks.add(toKey(i.date));
        }
        setCalendarMarks(marks);
      })
      .catch(error => console.log('Не удалось загрузить метки календаря:', error));
  }, [existingSchedule]);

  const pauseRangeStart = useMemo(() => {
    if (!pauseAnchor || !pauseCursor) return null;
    return pauseAnchor.getTime() <= pauseCursor.getTime() ? pauseAnchor : pauseCursor;
  }, [pauseAnchor, pauseCursor]);

  const pauseRangeEnd = useMemo(() => {
    if (!pauseAnchor || !pauseCursor) return null;
    return pauseAnchor.getTime() <= pauseCursor.getTime() ? pauseCursor : pauseAnchor;
  }, [pauseAnchor, pauseCursor]);

  // Время будильника — то самое, в которое он реально зазвонит. При
  // редактировании берётся из сохранённого графика, иначе по умолчанию 08:00.
  const [shiftTime, setShiftTime] = useState(() => {
    const d = new Date();
    if (existingSchedule) {
      const [hours, minutes] = ringTimeOf(existingSchedule).split(':').map(Number);
      d.setHours(hours, minutes, 0, 0);
    } else {
      d.setHours(8, 0, 0, 0);
    }
    return d;
  });
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // При редактировании дата старта берётся из сохранённого графика напрямую
  // (стрелки сдвига цикла при этом временно не пересчитывают её заново).
  // При создании нового — по умолчанию выравниваем цикл так, чтобы первый
  // день паттерна попал на понедельник (обычная пятидневка Пн-Пт).
  const [startOffset, setStartOffset] = useState(() => {
    const todayDate = startOfDay(new Date());
  
    if (existingSchedule) {
      // Берём разницу в днях между сохранённой датой и сегодня БЕЗ
      // приведения по модулю длины цикла — раньше модуль сворачивал любой
      // сдвиг в диапазон [0, length-1], из-за чего при повторном открытии
      // экран показывал ДРУГУЮ (хоть и эквивалентную по фазе) дату вместо
      // той, что реально выбирал пользователь — выглядело как "сброс".
      const [year, month, day] = existingSchedule.startDate.split('-').map(Number);
      const storedDate = new Date(year, month - 1, day);
      return Math.round((storedDate.getTime() - todayDate.getTime()) / 86400000);
    }
  
    const todayWeekday = (todayDate.getDay() + 6) % 7; // Пн=0 ... Вс=6
    const daysUntilMonday = (7 - todayWeekday) % 7;
    return daysUntilMonday % pattern.length;
  });
  
  const startDate = useMemo(() => startOfDay(addDays(new Date(), startOffset)), [startOffset]);

  const monthWeeks = useMemo(() => chunkIntoWeeks(buildMonthGrid(visibleMonth)), [visibleMonth]);

  const today = useMemo(() => startOfDay(new Date()), []);

  // Снимок исходного состояния — чтобы понимать, реально ли пользователь
  // что-то поменял. Фиксируется один раз при открытии экрана.
  const initialStartOffsetRef = useRef(startOffset);

const initialSignatureRef = useRef(
  JSON.stringify({
    name: existingSchedule?.name ?? presetName,
    color: existingSchedule?.color ?? SCHEDULE_COLORS[0],
    shiftStartTime: existingSchedule ? ringTimeOf(existingSchedule) : '08:00',
    overrides: serializeOverrides({}),
    startOffset: initialStartOffsetRef.current,
  }),
);
  
const hasChanges = useMemo(() => {
  const currentSignature = JSON.stringify({
    name,
    color: selectedColor,
    shiftStartTime: formatTime(shiftTime),
    overrides: serializeOverrides(overrides),
    startOffset,
  });
  return currentSignature !== initialSignatureRef.current;
}, [name, selectedColor, shiftTime, overrides, startOffset]);

  const showSaveButton = !isEditing || hasChanges;

  function dateKey(d: Date) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
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

  function handlePauseDayTap(day: Date) {
    if (!pauseAnchor) {
      setPauseAnchor(day);
      setPauseCursor(day);
      return;
    }

    if (isSameDay(day, pauseAnchor)) {
      // Повторный тап по тому же первому дню — интуитивная отмена выбора,
      // а не схлопывание диапазона обратно в один день.
      setPauseAnchor(null);
      setPauseCursor(null);
      return;
    }

    setPauseCursor(day);
  }

  function handleCancelPauseSelection() {
    setIsPauseSelectMode(false);
    setIsPauseFormOpen(false);
    setIsCustomPauseLabel(false);
    setPauseAnchor(null);
    setPauseCursor(null);
    setPauseLabel('');
  }

  async function handleSavePause() {
    if (!existingSchedule) {
      Alert.alert('Сначала сохрани график', 'Паузу можно добавить только уже сохранённому графику.');
      return;
    }
    if (!pauseRangeStart || !pauseRangeEnd) return;

    // Не даём создать паузу, пересекающуюся с уже существующей — иначе
    // обе "делят" одни и те же day_overrides (это просто плоская карта
    // дат без привязки к конкретной паузе), и удаление одной стирает
    // эффект другой, оставляя её "призраком" в списке.
    const hasOverlap = eachDateInRange(pauseRangeStart, pauseRangeEnd).some(day =>
      isDateInAnyPause(day, pauses),
    );
    if (hasOverlap) {
      Alert.alert(
        'Даты уже заняты',
        'Часть выбранного диапазона уже входит в другую паузу. Сначала удали её или выбери другие даты',
      );
      return;
    }

    // Весь диапазон помечаем выходным поверх обычного паттерна — сливаем
    // с уже существующими overrides, не затирая точечные правки вне диапазона.
    const nextOverrides: Record<string, DayOverride> = { ...overrides };
    for (const day of eachDateInRange(pauseRangeStart, pauseRangeEnd)) {
      nextOverrides[dateKey(day)] = 'rest';
    }

    const overridesList = Object.entries(nextOverrides).map(([key, value]) => {
      const [year, month, day] = key.split('-').map(Number);
      return {
        date: formatIsoDate(new Date(year, month - 1, day)),
        isWork: value === 'work',
      };
    });

    const newPause: NativeSchedulePause = {
      id: uuid.v4() as string,
      scheduleId: existingSchedule.id,
      startDate: formatIsoDate(pauseRangeStart),
      endDate: formatIsoDate(pauseRangeEnd),
      label: pauseLabel.trim() || 'Пауза',
    };

    try {
      await saveDayOverrides(existingSchedule.id, overridesList);
      await saveSchedulePause(newPause);

      setOverrides(nextOverrides);
      setPauses(prev => [...prev, newPause]);

      // Пауза сохраняется сама по себе сразу (как и события) — обновляем
      // "снимок исходного состояния", чтобы кнопка "Сохранить изменения"
      // внизу экрана не зажглась ложно для уже сохранённого действия.
      initialSignatureRef.current = JSON.stringify({
        name,
        color: selectedColor,
        shiftStartTime: formatTime(shiftTime),
        overrides: serializeOverrides(nextOverrides),
        startOffset,
      });

      handleCancelPauseSelection();
    } catch (error) {
      Alert.alert('Не удалось сохранить паузу', String(error));
    }
  }

  function handleDeletePause(pause: NativeSchedulePause) {
    Alert.alert('Удалить паузу?', `«${pause.label}» — будильники на этот диапазон вернутся к обычному графику.`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          if (!existingSchedule) return;

          const [sy, sm, sd] = pause.startDate.split('-').map(Number);
          const [ey, em, ed] = pause.endDate.split('-').map(Number);
          const rangeStart = new Date(sy, sm - 1, sd);
          const rangeEnd = new Date(ey, em - 1, ed);

          const nextOverrides: Record<string, DayOverride> = { ...overrides };
          for (const day of eachDateInRange(rangeStart, rangeEnd)) {
            delete nextOverrides[dateKey(day)];
          }

          const overridesList = Object.entries(nextOverrides).map(([key, value]) => {
            const [year, month, day] = key.split('-').map(Number);
            return {
              date: formatIsoDate(new Date(year, month - 1, day)),
              isWork: value === 'work',
            };
          });

          try {
            await saveDayOverrides(existingSchedule.id, overridesList);
            await deleteSchedulePause(pause.id);

            setOverrides(nextOverrides);
            setPauses(prev => prev.filter(p => p.id !== pause.id));

            initialSignatureRef.current = JSON.stringify({
              name,
              color: selectedColor,
              shiftStartTime: formatTime(shiftTime),
              overrides: serializeOverrides(nextOverrides),
              startOffset,
            });
          } catch (error) {
            Alert.alert('Не удалось удалить паузу', String(error));
          }
        },
      },
    ]);
  }

  async function handleSave() {
    const nativeSchedule: NativeWorkSchedule = {
      id: existingSchedule?.id ?? (uuid.v4() as string),
      name,
      color: selectedColor,
      pattern,
      sourcePresetId: presetId === 'custom' ? null : presetId,
      startDate: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`,
      shiftStartTime: `${String(shiftTime.getHours()).padStart(2, '0')}:${String(shiftTime.getMinutes()).padStart(2, '0')}:00`,
      // Ровно один будильник, offset = 0: время будильника и есть shiftStartTime.
      alarms: [
        {
          id: existingSchedule?.alarms[0]?.id ?? (uuid.v4() as string),
          offsetMinutes: 0,
          ringtoneId: existingSchedule?.alarms[0]?.ringtoneId ?? 'default',
          vibration: existingSchedule?.alarms[0]?.vibration ?? true,
        },
      ],
      isActive: existingSchedule?.isActive ?? false,
      isPaused: existingSchedule?.isPaused ?? false,
    };

    try {
      await saveWorkSchedule(nativeSchedule);
    
      const overridesList = Object.entries(overrides).map(([key, value]) => {
        const [year, month, day] = key.split('-').map(Number);
        return {
          date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          isWork: value === 'work',
        };
      });
      await saveDayOverrides(nativeSchedule.id, overridesList);
    
      if (isEditing) {
        // Сначала схлопываем стек графиков обратно до списка (иначе сам
        // экран настройки остаётся "живым" в истории навигации, просто скрытым
        // за другой вкладкой) — и только потом переключаемся на вкладку Календарь.
        navigation.popToTop();
        (navigation.getParent() as any)?.navigate('Calendar');
      } else {
        navigation.navigate('SchedulesList', { justCreatedId: nativeSchedule.id });
      }
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

      <Text style={styles.sectionLabel}>Время будильника</Text>
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

{existingSchedule && (
  <>
    <Text style={styles.sectionLabel}>Паузы (отпуск, больничный)</Text>

    {pauses.map(pause => (
      <View key={pause.id} style={styles.pauseRow}>
        <View style={styles.pauseInfo}>
          <Text style={styles.pauseLabel}>{pause.label}</Text>
          <Text style={styles.pauseRange}>
            {pause.startDate} — {pause.endDate}
          </Text>
        </View>
        <Pressable onPress={() => handleDeletePause(pause)} hitSlop={8}>
          <Trash2 color={colors.accent} size={18} />
        </Pressable>
      </View>
    ))}

{isPauseSelectMode ? (
            <View style={styles.pauseToolbar}>
              <Text style={styles.pauseToolbarHint}>
                {pauseRangeStart && pauseRangeEnd
                  ? `${formatStartLabel(pauseRangeStart)} — ${formatStartLabel(pauseRangeEnd)}`
                  : 'Нажми на первый и последний день в календаре выше'}
              </Text>
              <View style={styles.pauseToolbarButtons}>
                <Pressable onPress={handleCancelPauseSelection} hitSlop={8}>
                  <X color={colors.textSecondary} size={20} />
                </Pressable>
                <Pressable
                  disabled={!pauseRangeStart}
                  onPress={() => setIsPauseFormOpen(true)}
                  hitSlop={8}
                >
                  <Check color={pauseRangeStart ? colors.accent : colors.border} size={20} />
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={styles.addPauseButton} onPress={() => setIsPauseSelectMode(true)}>
              <Plus color={colors.accent} size={18} />
              <Text style={styles.addPauseButtonText}>Добавить паузу</Text>
            </Pressable>
          )}

<Modal
            visible={isPauseFormOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setIsPauseFormOpen(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <View style={styles.modalIconCircle}>
                  <CalendarRange color={colors.pauseAccent} size={24} />
                </View>

                <Text style={styles.modalRangeText}>
                  {pauseRangeStart && pauseRangeEnd
                    ? `${formatStartLabel(pauseRangeStart)} — ${formatStartLabel(pauseRangeEnd)}`
                    : ''}
                </Text>

                {isCustomPauseLabel ? (
                  <TextInput
                    style={styles.input}
                    value={pauseLabel}
                    onChangeText={setPauseLabel}
                    placeholder="Например: Переезд"
                    placeholderTextColor={colors.textSecondary}
                    autoFocus
                  />
                ) : (
                  <View style={styles.pauseChipsRow}>
                    {PAUSE_LABEL_PRESETS.map(preset => (
                      <Pressable
                        key={preset}
                        style={[styles.pauseChip, pauseLabel === preset && styles.pauseChipSelected]}
                        onPress={() => setPauseLabel(preset)}
                      >
                        <Text
                          style={[
                            styles.pauseChipText,
                            pauseLabel === preset && styles.pauseChipTextSelected,
                          ]}
                        >
                          {preset}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable
                      style={styles.pauseChip}
                      onPress={() => {
                        setPauseLabel('');
                        setIsCustomPauseLabel(true);
                      }}
                    >
                      <Text style={styles.pauseChipText}>Другое</Text>
                    </Pressable>
                  </View>
                )}

                <View style={styles.pauseFormButtons}>
                  <Pressable style={styles.pauseFormCancel} onPress={() => setIsPauseFormOpen(false)}>
                    <Text style={styles.pauseFormCancelText}>Назад</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.pauseFormSave, !pauseLabel.trim() && styles.saveButtonDisabled]}
                    disabled={!pauseLabel.trim()}
                    onPress={handleSavePause}
                  >
                    <Text style={styles.pauseFormSaveText}>Сохранить</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
  </>
)}

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
                const isToday = isSameDay(day, today);
                const hasOverride = override !== undefined;
                const isPauseOverride = hasOverride && isDateInAnyPause(day, pauses);
                const hasCalendarMark = calendarMarks.has(key);

                const isInPauseSelection =
                isPauseSelectMode &&
                pauseRangeStart !== null &&
                pauseRangeEnd !== null &&
                day.getTime() >= pauseRangeStart.getTime() &&
                day.getTime() <= pauseRangeEnd.getTime();

              return (
                <Pressable
                  key={i}
                  style={styles.dayCell}
                  disabled={!inCurrentMonth}
                  onPress={() => (isPauseSelectMode ? handlePauseDayTap(day) : handleDayTap(day))}
                >
                    <View
                      style={[
                        styles.dayCircle,
                        inCurrentMonth && effectiveIsWork && styles.dayCircleWork,
                        inCurrentMonth && isToday && styles.dayCircleStart,
                        inCurrentMonth && hasOverride && !isPauseOverride && styles.dayCircleOverride,
                        inCurrentMonth && isPauseOverride && styles.dayCirclePauseOverride,
                        inCurrentMonth && isInPauseSelection && styles.dayCirclePauseSelected,
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
                    {inCurrentMonth && hasCalendarMark && <View style={styles.calendarMarkDot} />}
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
            <Text style={styles.legendText}>Изменено</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.legendDotPause]} />
            <Text style={styles.legendText}>Пауза</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: calendarChangeColor }]} />
            <Text style={styles.legendText}>Из календаря</Text>
          </View>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Начать цикл с</Text>
      <View style={styles.stepperRow}>
      <Pressable
          style={[
            styles.stepperArrow,
            startOffset <= -(pattern.length - 1) && styles.stepperArrowDisabled,
          ]}
          disabled={startOffset <= -(pattern.length - 1)}
          onPress={() => setStartOffset(o => o - 1)}
        >
          <ChevronLeft
            color={startOffset <= -(pattern.length - 1) ? colors.border : colors.textPrimary}
            size={22}
          />
        </Pressable>

        <View style={styles.stepperLabelBlock}>
          <Text style={styles.stepperLabel}>{formatStartLabel(startDate)}</Text>
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

{showSaveButton && (
        <Pressable
          style={styles.saveButton}
          onPress={handleSave}
        >
          <Text style={styles.saveButtonText}>
            {isEditing ? 'Сохранить изменения' : 'Сохранить график'}
          </Text>
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
    marginBottom: spacing.md,
  },
  calendarMonthLabel: { ...typography.body, color: colors.textPrimary, textTransform: 'capitalize' },
  weekdaysRow: { flexDirection: 'row' },
  weekdayLabel: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: 'center' },
  weekRow: { flexDirection: 'row' },
  dayCell: { flex: 1, aspectRatio: 1, justifyContent: 'center', alignItems: 'center' },
  calendarMarkDot: {
    position: 'absolute',
    top: 2,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: calendarChangeColor,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  dayCircle: {
    width: '78%',
    height: '78%',
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayCircleWork: { backgroundColor: colors.accent, borderRadius: 999 },
  dayCircleStart: { borderWidth: 2, borderColor: colors.textPrimary, borderRadius: 999 },
  dayCircleOverride: { borderWidth: 2, borderColor: colors.accentSecondary, borderRadius: 999 },
  todayDot: {
    position: 'absolute',
    bottom: 2,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  dayNumber: { ...typography.caption, color: colors.textSecondary },
  dayNumberMuted: { color: colors.border },
  dayNumberWork: { color: colors.background, fontWeight: '600' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.sm, marginTop: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendDotOverride: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.accentSecondary,
  },
  legendDotPause: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.pauseAccent,
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
  pauseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pauseInfo: {},
  pauseLabel: { ...typography.body, color: colors.textPrimary },
  pauseRange: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  addPauseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: spacing.md,
  },
  addPauseButtonText: { ...typography.body, color: colors.accent, fontWeight: '600' },
  pauseToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  pauseToolbarHint: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  pauseToolbarButtons: { flexDirection: 'row', gap: spacing.md },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  modalRangeText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
    textAlign: 'center',
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  pauseChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pauseChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 20,
    backgroundColor: colors.background,
  },
  pauseChipSelected: { backgroundColor: colors.pauseAccent },
  pauseChipText: { ...typography.caption, color: colors.textSecondary },
  pauseChipTextSelected: { color: colors.background, fontWeight: '600' },
  pauseFormButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  pauseFormCancel: {
    flex: 1,
    backgroundColor: colors.border,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  pauseFormCancelText: { ...typography.body, color: colors.textPrimary },
  pauseFormSave: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  pauseFormSaveText: { ...typography.body, fontWeight: '600', color: colors.background },
  dayCirclePauseOverride: { borderWidth: 2, borderColor: colors.pauseAccent, borderRadius: 999 },
  dayCirclePauseSelected: {
    backgroundColor: colors.pauseAccentSelecting,
    borderRadius: 999,
  },
});