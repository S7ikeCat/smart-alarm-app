import React, { useCallback, useState } from 'react';
import { Alert, BackHandler, FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Trash2, Check, Folder, X } from 'lucide-react-native';
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
import { loadSeries, saveSeriesList, AlarmSeries } from '../../native/alarmSeries';
import { cityName } from '../../utils/timezones';
import { KIND_LABELS, dateToKey, formatKeyLong, shortTime } from '../../utils/timeUtils';

type SheetState =
  | { type: 'none' }
  | { type: 'edit'; alarm: NativeExtraAlarm | null; fromSeries?: string }
  | { type: 'series' }
  | { type: 'folder'; id: string };

type ListItem =
  | { type: 'alarm'; alarm: NativeExtraAlarm; time: string }
  | { type: 'series'; series: AlarmSeries; members: NativeExtraAlarm[]; time: string };

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
  const [series, setSeries] = useState<AlarmSeries[]>([]);
  const [confirmFolderDelete, setConfirmFolderDelete] = useState(false);
  const todayKey = dateToKey(new Date());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isSelectionMode = selectedIds.size > 0;

  const reload = useCallback(() => {
    Promise.all([loadExtraAlarms(), loadSeries()])
      .then(([list, savedSeries]) => {
        const sorted = [...list].sort((a, b) => a.timeLocal.localeCompare(b.timeLocal));
        setAlarms(sorted);
        // Папки без живых будильников (удалили по одному) убираем.
        const ids = new Set(sorted.map(a => a.id));
        const cleaned = savedSeries
          .map(s => ({ ...s, alarmIds: s.alarmIds.filter(id => ids.has(id)) }))
          .filter(s => s.alarmIds.length > 0);
        setSeries(cleaned);
        if (JSON.stringify(cleaned) !== JSON.stringify(savedSeries)) saveSeriesList(cleaned).catch(() => {});
      })
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
    const ids = new Set<string>();
    for (const key of selectedIds) {
      if (key.startsWith('s:')) {
        series.find(s => s.id === key.slice(2))?.alarmIds.forEach(id => ids.add(id));
      } else {
        ids.add(key);
      }
    }
    try {
      await Promise.all(Array.from(ids).map(id => deleteExtraAlarm(id)));
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
    setConfirmFolderDelete(false);
    setSheet(prev => (prev.type === 'edit' && prev.fromSeries ? { type: 'folder', id: prev.fromSeries } : { type: 'none' }));
  }

  function handleDone() {
    closeSheet();
    reload();
  }

  async function toggleSeries(s: AlarmSeries, members: NativeExtraAlarm[], enabled: boolean) {
    setAlarms(prev => prev.map(a => (s.alarmIds.includes(a.id) ? { ...a, enabled } : a)));
    try {
      for (const a of members) await saveExtraAlarm({ ...a, enabled });
    } catch (error) {
      console.log('Не удалось переключить папку:', error);
      reload();
    }
  }

  async function renameSeries(s: AlarmSeries, name: string) {
    const clean = name.trim();
    if (!clean || clean === s.name) return;
    const next = series.map(x => (x.id === s.id ? { ...x, name: clean } : x));
    setSeries(next);
    await saveSeriesList(next).catch(() => {});
  }

  async function deleteSeries(s: AlarmSeries) {
    try {
      await Promise.all(s.alarmIds.map(id => deleteExtraAlarm(id)));
      setConfirmFolderDelete(false);
      setSheet({ type: 'none' });
      reload();
    } catch (error) {
      Alert.alert('Не удалось удалить папку', String(error));
    }
  }

  const inSeries = new Set(series.flatMap(s => s.alarmIds));
  const items: ListItem[] = [
    ...series.map(s => {
      const members = alarms.filter(a => s.alarmIds.includes(a.id));
      return { type: 'series' as const, series: s, members, time: members[0]?.timeLocal ?? '99' };
    }),
    ...alarms.filter(a => !inSeries.has(a.id)).map(a => ({ type: 'alarm' as const, alarm: a, time: a.timeLocal })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  const openSeries = sheet.type === 'folder' ? series.find(s => s.id === sheet.id) : undefined;
  const openMembers = openSeries ? alarms.filter(a => openSeries.alarmIds.includes(a.id)) : [];

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { paddingTop: insets.top + spacing.md }]}>Будильники</Text>
      <Text style={styles.subtitle}>
        Звонят сами по себе — в рабочие дни, в выходные или в нужную дату, поверх графика и событий. Удерживай будильник или папку, чтобы выбрать и удалить несколько.
      </Text>

      <FlatList
        data={items}
        keyExtractor={item => (item.type === 'series' ? `s:${item.series.id}` : item.alarm.id)}
        contentContainerStyle={[styles.list, { paddingBottom: 120 }]}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Пока пусто. Нажми «+», чтобы добавить будильник, или «Серия», чтобы поставить сразу
            несколько подряд.
          </Text>
        }
        renderItem={({ item: row }) => {
          if (row.type === 'series') {
            const key = `s:${row.series.id}`;
            const isSelected = selectedIds.has(key);
            const times = row.members.map(m => m.timeLocal).sort();
            const anyOn = row.members.some(m => m.enabled);
            const kinds = Array.from(new Set(row.members.map(m => KIND_LABELS[m.kind])));
            return (
              <Pressable
                style={[styles.card, !anyOn && !isSelected && styles.cardOff, isSelected && styles.cardSelected]}
                onLongPress={() => {
                  if (!isSelectionMode) setSelectedIds(new Set([key]));
                }}
                onPress={() => {
                  if (isSelectionMode) toggleSelection(key);
                  else setSheet({ type: 'folder', id: row.series.id });
                }}
              >
                {isSelectionMode && (
                  <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                    {isSelected && <Check color={colors.background} size={14} />}
                  </View>
                )}
                <View style={styles.folderIcon}>
                  <Folder color={colors.accent} size={22} />
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.folderName} numberOfLines={1}>{row.series.name}</Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {row.members.length} шт. · {shortTime(times[0])}–{shortTime(times[times.length - 1])} · {kinds.join(', ')}
                  </Text>
                </View>
                {!isSelectionMode && (
                  <>
                    <Switch
                      value={anyOn}
                      onValueChange={value => toggleSeries(row.series, row.members, value)}
                      trackColor={{ false: colors.border, true: colors.accent }}
                    />
                  </>
                )}
              </Pressable>
            );
          }
          const item = row.alarm;
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
                {!!item.sourceTz && (
                  <Text style={styles.meta} numberOfLines={1}>
                    по времени: {cityName(item.sourceTz)}
                  </Text>
                )}
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
        {sheet.type === 'folder' && openSeries && (
          <View>
            <View style={styles.folderHead}>
              <Folder color={colors.accent} size={22} />
              <TextInput
                style={styles.folderTitleInput}
                defaultValue={openSeries.name}
                onEndEditing={e => renameSeries(openSeries, e.nativeEvent.text)}
                maxLength={30}
                placeholderTextColor={colors.textSecondary}
              />
              <Switch
                value={openMembers.some(m => m.enabled)}
                onValueChange={value => toggleSeries(openSeries, openMembers, value)}
                trackColor={{ false: colors.border, true: colors.accent }}
              />
            </View>
            {openMembers.map(m => (
              <Pressable
                key={m.id}
                style={[styles.memberRow, !m.enabled && styles.cardOff]}
                onPress={() => setSheet({ type: 'edit', alarm: m, fromSeries: openSeries.id })}
              >
                <Text style={styles.memberTime}>{shortTime(m.timeLocal)}</Text>
                <Text style={styles.memberMeta} numberOfLines={1}>
                  {m.label ? `${m.label} · ` : ''}
                  {describe(m)}
                </Text>
                <Switch
                  value={m.enabled}
                  onValueChange={value => toggleEnabled(m, value)}
                  trackColor={{ false: colors.border, true: colors.accent }}
                />
              </Pressable>
            ))}
            {confirmFolderDelete ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmText}>Удалить папку вместе со всеми её будильниками?</Text>
                <View style={styles.folderActions}>
                  <Pressable style={styles.squareBtn} onPress={() => setConfirmFolderDelete(false)}>
                    <X color={colors.textSecondary} size={24} />
                  </Pressable>
                  <Pressable style={styles.confirmDelete} onPress={() => deleteSeries(openSeries)}>
                    <Trash2 color={colors.textPrimary} size={24} />
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.folderActions}>
                <Pressable style={styles.squareBtn} onPress={closeSheet}>
                  <X color={colors.textSecondary} size={24} />
                </Pressable>
                <Pressable style={[styles.squareBtn, styles.squareDanger]} onPress={() => setConfirmFolderDelete(true)}>
                  <Trash2 color="#D64541" size={22} />
                </Pressable>
              </View>
            )}
          </View>
        )}
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
  folderIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(232,135,90,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  folderName: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  folderHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  folderTitleInput: { ...typography.headline, color: colors.textPrimary, flex: 1, padding: 0 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  memberTime: { fontSize: 24, fontWeight: '700', color: colors.textPrimary },
  memberMeta: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  folderActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  squareBtn: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squareDanger: { borderWidth: 1.5, borderColor: 'rgba(214,69,65,0.6)' },
  confirmBox: { marginTop: spacing.sm },
  confirmText: { ...typography.body, color: colors.textSecondary },
  confirmDelete: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#D64541',
    alignItems: 'center',
    justifyContent: 'center',
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