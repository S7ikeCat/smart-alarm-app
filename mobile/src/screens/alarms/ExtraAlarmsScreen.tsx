import React, { useCallback, useState } from 'react';
import { Alert, BackHandler, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Trash2, Check } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import { BottomSheet } from '../../components/BottomSheet';
import { ExtraAlarmForm } from '../../components/ExtraAlarmForm';
import { SeriesForm } from '../../components/SeriesForm';
import {
  NativeExtraAlarm,
  loadExtraAlarms,
  saveExtraAlarm,
  deleteExtraAlarm,
} from '../../native/alarmCore';
import { KIND_LABELS, dateToKey, formatKeyLong, shortTime } from '../../utils/timeUtils';

type SheetState =
  | { type: 'none' }
  | { type: 'edit'; alarm: NativeExtraAlarm | null }
  | { type: 'series' };

function describe(alarm: NativeExtraAlarm): string {
  if (alarm.kind === 'ONE_DATE' && alarm.date) {
    return formatKeyLong(alarm.date);
  }
  return KIND_LABELS[alarm.kind];
}

export function ExtraAlarmsScreen() {
  const insets = useSafeAreaInsets();
  const [alarms, setAlarms] = useState<NativeExtraAlarm[]>([]);
  const [sheet, setSheet] = useState<SheetState>({ type: 'none' });
  const todayKey = dateToKey(new Date());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isSelectionMode = selectedIds.size > 0;

  const reload = useCallback(() => {
    loadExtraAlarms()
      .then(list => setAlarms([...list].sort((a, b) => a.timeLocal.localeCompare(b.timeLocal))))
      .catch(error => console.log('Не удалось загрузить будильники:', error));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Кнопка "назад" сначала снимает выделение, а не уводит с экрана.
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (isSelectionMode) {
          setSelectedIds(new Set());
          return true;
        }
        return false;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [isSelectionMode]),
  );

  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(ids.map(id => deleteExtraAlarm(id)));
      setSelectedIds(new Set());
      reload();
    } catch (error) {
      Alert.alert('Не удалось удалить будильники', String(error));
    }
  }

  async function toggleEnabled(alarm: NativeExtraAlarm, enabled: boolean) {
    setAlarms(prev => prev.map(a => (a.id === alarm.id ? { ...a, enabled } : a)));
    try {
      await saveExtraAlarm({ ...alarm, enabled });
    } catch (error) {
      console.log('Не удалось переключить будильник:', error);
      reload();
    }
  }

  function closeSheet() {
    setSheet({ type: 'none' });
  }

  function handleDone() {
    closeSheet();
    reload();
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { paddingTop: insets.top + spacing.md }]}>Будильники</Text>
      <Text style={styles.subtitle}>
        Звонят сами по себе — в рабочие дни, в выходные или в нужную дату, поверх графика и событий. Удерживай будильник, чтобы выбрать и удалить несколько.
      </Text>

      <FlatList
        data={alarms}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: 120 }]}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Пока пусто. Нажми «+», чтобы добавить будильник, или «Серия», чтобы поставить сразу
            несколько подряд.
          </Text>
        }
        renderItem={({ item }) => {
          const expired = item.kind === 'ONE_DATE' && !!item.date && item.date < todayKey;
          const isSelected = selectedIds.has(item.id);
          return (
            <Pressable
              style={[
                styles.card,
                (!item.enabled || expired) && !isSelected && styles.cardOff,
                isSelected && styles.cardSelected,
              ]}
              onLongPress={() => {
                if (!isSelectionMode) setSelectedIds(new Set([item.id]));
              }}
              onPress={() => {
                if (isSelectionMode) toggleSelection(item.id);
                else setSheet({ type: 'edit', alarm: item });
              }}
            >
              {isSelectionMode && (
                <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                  {isSelected && <Check color={colors.background} size={14} />}
                </View>
              )}
              <View style={styles.cardBody}>
                <Text style={styles.time}>{shortTime(item.timeLocal)}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.label ? `${item.label} · ` : ''}
                  {describe(item)}
                  {expired ? ' · прошёл' : ''}
                </Text>
              </View>
              {!isSelectionMode && (
                <Switch
                  value={item.enabled}
                  onValueChange={value => toggleEnabled(item, value)}
                  trackColor={{ false: colors.border, true: colors.accent }}
                />
              )}
            </Pressable>
          );
        }}
      />

      <View style={[styles.bottomBar, { bottom: spacing.lg }]}>
        {isSelectionMode ? (
          <View style={[styles.fabShadow, styles.fabDanger]}>
            <Pressable style={styles.fabPress} onPress={handleDeleteSelected}>
              <Trash2 color={colors.textPrimary} size={24} />
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable style={styles.seriesBtn} onPress={() => setSheet({ type: 'series' })}>
              <Text style={styles.seriesText}>Серия</Text>
            </Pressable>
            <View style={styles.fabShadow}>
              <Pressable style={styles.fabPress} onPress={() => setSheet({ type: 'edit', alarm: null })}>
                <Plus color={colors.background} size={26} />
              </Pressable>
            </View>
          </>
        )}
      </View>

      <BottomSheet visible={sheet.type !== 'none'} onClose={closeSheet}>
        {sheet.type === 'edit' && (
          <ExtraAlarmForm alarm={sheet.alarm} onDone={handleDone} onCancel={closeSheet} />
        )}
        {sheet.type === 'series' && <SeriesForm onDone={handleDone} onCancel={closeSheet} />}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { ...typography.headline, color: colors.textPrimary, paddingHorizontal: spacing.lg },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  list: { paddingHorizontal: spacing.lg },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },
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
  cardOff: { opacity: 0.5 },
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
  fabDanger: { backgroundColor: '#C0453A' },
  cardBody: { flex: 1 },
  time: { fontSize: 30, fontWeight: '700', color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  bottomBar: {
    position: 'absolute',
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  seriesBtn: {
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seriesText: { ...typography.body, color: colors.accent, fontWeight: '600' },
  // Тень вешаем на отдельный круглый контейнер с однотонным фоном, а нажимаемая
  // кнопка лежит внутри и сама тени не имеет — так Android рисует тень строго по
  // кругу, а не по прямоугольнику кнопки.
  fabShadow: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    elevation: 4,
  },
  fabPress: {
    flex: 1,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});