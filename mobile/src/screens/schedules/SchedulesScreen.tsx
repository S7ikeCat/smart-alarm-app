import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Plus, Trash2, Check } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { SchedulesStackParamList } from '../../navigation/types';
import { loadWorkSchedules, NativeWorkSchedule } from '../../native/alarmCore';

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

  // Перезагружаем список каждый раз, когда экран получает фокус — не только
  // при первом открытии. Иначе после сохранения нового графика список
  // останется старым до перезапуска приложения.
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

  function handlePress(id: string) {
    if (isSelectionMode) {
      toggleSelection(id);
    }
    // TODO: вне режима выбора — открыть детали графика, когда появится экран
  }

  function handleDelete() {
    // TODO: пока убирает только с экрана — настоящее удаление из БД появится,
    // когда добавим delete_work_schedule_ffi в Rust-ядро
    setSchedules(prev => prev.filter(s => !selectedIds.has(s.id)));
    setSelectedIds(new Set());
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
                !item.isActive && !isSelected && styles.cardPaused,
                isSelected && styles.cardSelected,
              ]}
              onLongPress={() => handleLongPress(item.id)}
              onPress={() => handlePress(item.id)}
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
                  {!item.isActive && <Text style={styles.pausedLabel}>На паузе</Text>}
                </View>
              </View>
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
  cardPaused: { opacity: 0.5 },
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
    marginRight: spacing.sm,
  },
  badgeText: { ...typography.caption, fontSize: 11, color: colors.textSecondary },
  pausedLabel: { ...typography.caption, color: colors.accent },
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