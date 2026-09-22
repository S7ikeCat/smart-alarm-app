import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Alert, BackHandler } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Plus, Trash2, Check, Circle, CircleDot } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { SchedulesStackParamList } from '../../navigation/types';
import { loadWorkSchedules, deleteWorkSchedule, setActiveSchedule, NativeWorkSchedule } from '../../native/alarmCore';

type Navigation = NativeStackNavigationProp<SchedulesStackParamList, 'SchedulesList'>;

function patternLabel(pattern: boolean[]) {
  const workCount = pattern.filter(Boolean).length;
  const restCount = pattern.length - workCount;
  return `${workCount}/${restCount} за ${pattern.length} дн.`;
}

export function SchedulesScreen() {
  const navigation = useNavigation<Navigation>();
  const [schedules, setSchedules] = useState<NativeWorkSchedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isSelectionMode = selectedIds.size > 0;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setIsLoading(true);
      loadWorkSchedules()
        .then(result => {
          if (!cancelled) setSchedules(result);
        })
        .catch(error => {
          console.log('Не удалось загрузить графики:', error);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Кнопка "назад" сначала отменяет режим выбора, а не сразу уводит с экрана —
  // так пользователь может передумать удалять, не теряя контекст.
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (isSelectionMode) {
          setSelectedIds(new Set());
          return true; // забираем событие на себя, не даём уйти с экрана
        }
        return false; // обычное поведение "назад"
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [isSelectionMode]),
  );

  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleLongPress(id: string) {
    if (!isSelectionMode) {
      setSelectedIds(new Set([id]));
    }
  }

  async function handleSetActive(scheduleId: string) {
    try {
      await setActiveSchedule(scheduleId);
      setSchedules(prev => prev.map(s => ({ ...s, isActive: s.id === scheduleId })));
    } catch (error) {
      Alert.alert('Не удалось выбрать график', String(error));
    }
  }

  function handlePress(schedule: NativeWorkSchedule) {
    if (isSelectionMode) {
      toggleSelection(schedule.id);
      return;
    }

    if (!schedule.isActive) {
      // Первый тап по неактивному графику — просто делаем его активным,
      // остаёмся на экране. Настроить его можно вторым тапом, когда он
      // уже станет активным — так не нужна отдельная маленькая кнопка,
      // по которой легко промахнуться.
      handleSetActive(schedule.id);
      return;
    }

    navigation.navigate('ConfigureSchedule', {
      presetId: schedule.sourcePresetId ?? 'custom',
      presetName: schedule.name,
      pattern: schedule.pattern,
      existingSchedule: schedule,
    });
  }

  async function handleDelete() {
    const idsToDelete = Array.from(selectedIds);
    try {
      await Promise.all(idsToDelete.map(id => deleteWorkSchedule(id)));
      setSchedules(prev => prev.filter(s => !selectedIds.has(s.id)));
      setSelectedIds(new Set());
    } catch (error) {
      Alert.alert('Не удалось удалить график', String(error));
    }
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (schedules.length === 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyText}>Графиков пока нет</Text>
        <Pressable style={styles.fab} onPress={() => navigation.navigate('CreateSchedule')}>
          <Plus color={colors.background} size={26} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={schedules}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const isSelected = selectedIds.has(item.id);
          return (
            <Pressable
              style={[
                styles.card,
                !item.isActive && !isSelected && styles.cardInactive,
                isSelected && styles.cardSelected,
              ]}
              onLongPress={() => handleLongPress(item.id)}
              onPress={() => handlePress(item)}
            >
              {isSelectionMode && (
                <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                  {isSelected && <Check color={colors.background} size={14} />}
                </View>
              )}
              <View style={[styles.colorDot, { backgroundColor: item.color }]} />
              <View style={styles.cardBody}>
                <Text style={styles.cardName}>{item.name}</Text>
                <View style={styles.cardMetaRow}>
                  <Text style={styles.cardPattern}>{patternLabel(item.pattern)}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {item.sourcePresetId ? 'Шаблон' : 'Свой'}
                    </Text>
                  </View>
                </View>
              </View>
              {!isSelectionMode &&
                (item.isActive ? (
                  <CircleDot color={colors.accent} size={22} />
                ) : (
                  <Circle color={colors.textSecondary} size={22} />
                ))}
            </Pressable>
          );
        }}
      />

      {isSelectionMode ? (
        <Pressable style={[styles.fab, styles.fabDanger]} onPress={handleDelete}>
          <Trash2 color={colors.textPrimary} size={24} />
        </Pressable>
      ) : (
        <Pressable style={styles.fab} onPress={() => navigation.navigate('CreateSchedule')}>
          <Plus color={colors.background} size={26} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { justifyContent: 'center', alignItems: 'center' },
  emptyText: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  list: { padding: spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardInactive: { opacity: 0.6 },
  cardSelected: { borderColor: colors.accent },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    marginRight: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  colorDot: { width: 12, height: 12, borderRadius: 6, marginRight: spacing.md },
  cardBody: { flex: 1 },
  cardName: { ...typography.body, color: colors.textPrimary, marginBottom: 4 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center' },
  cardPattern: { ...typography.caption, color: colors.textSecondary, marginRight: spacing.sm },
  badge: {
    backgroundColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { ...typography.caption, fontSize: 11, color: colors.textSecondary },
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