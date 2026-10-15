import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Modal, TextInput, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Sun, CalendarDays, Inbox, Flag, BellRing, CircleCheck, Plus, ChevronRight, Pencil, Trash2 } from 'lucide-react-native';
import uuid from 'react-native-uuid';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import type { ToolsStackParamList } from '../../navigation/types';
import {
  loadCustomEvents,
  loadReminderLists,
  saveReminderList,
  deleteReminderList,
  NativeCustomEvent,
  NativeReminderList,
} from '../../native/alarmCore';
import { dateToKey } from '../../utils/timeUtils';
import { filterSmart, SMART_TITLES, SmartFilter, LIST_COLORS } from '../../utils/reminders';

type Nav = NativeStackNavigationProp<ToolsStackParamList, 'RemindersHub'>;

const TILES: { filter: SmartFilter; color: string; Icon: any }[] = [
  { filter: 'today', color: '#4A90D9', Icon: Sun },
  { filter: 'planned', color: '#E8875A', Icon: CalendarDays },
  { filter: 'all', color: '#6B8CAE', Icon: Inbox },
  { filter: 'flagged', color: '#E8A33D', Icon: Flag },
  { filter: 'urgent', color: '#D64541', Icon: BellRing },
  { filter: 'done', color: '#4A7A6B', Icon: CircleCheck },
];

export function RemindersHubScreen() {
  const navigation = useNavigation<Nav>();
  const [events, setEvents] = useState<NativeCustomEvent[]>([]);
  const [lists, setLists] = useState<NativeReminderList[]>([]);
  const [menuList, setMenuList] = useState<NativeReminderList | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<NativeReminderList | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(LIST_COLORS[0]);

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

  function openNewList() {
    setName('');
    setColor(LIST_COLORS[lists.length % LIST_COLORS.length]);
    setEditing({ id: '', name: '', color: LIST_COLORS[0] });
  }

  function openEditList(l: NativeReminderList) {
    setName(l.name);
    setColor(l.color);
    setEditing(l);
  }

  async function submitList() {
    if (!editing || !name.trim()) return;
    try {
      await saveReminderList({ id: editing.id || (uuid.v4() as string), name: name.trim(), color });
      setEditing(null);
      refresh();
    } catch (error) {
      Alert.alert('Не удалось сохранить список', String(error));
    }
  }

  function closeMenu() {
    setMenuList(null);
    setConfirmDelete(false);
  }

  async function doDelete() {
    if (!menuList) return;
    const id = menuList.id;
    closeMenu();
    try {
      await deleteReminderList(id);
      refresh();
    } catch (error) {
      Alert.alert('Не удалось удалить список', String(error));
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.grid}>
          {TILES.map(({ filter, color: c, Icon }) => (
            <Pressable
              key={filter}
              style={styles.tile}
              onPress={() => navigation.navigate('ReminderList', { filter, title: SMART_TITLES[filter] })}
            >
              <View style={styles.tileTop}>
                <View style={[styles.tileIcon, { backgroundColor: c }]}>
                  <Icon color="#fff" size={18} />
                </View>
                <Text style={styles.tileCount}>{filterSmart(events, filter, todayKey).length}</Text>
              </View>
              <Text style={styles.tileTitle}>{SMART_TITLES[filter]}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.listsHeader}>
          <Text style={styles.sectionTitle}>Мои списки</Text>
          <Pressable onPress={openNewList} hitSlop={8} style={styles.addList}>
            <Plus color={colors.accent} size={16} />
            <Text style={styles.link}>Список</Text>
          </Pressable>
        </View>

        {lists.length === 0 && (
          <Text style={styles.empty}>Списков пока нет. Создай, например, «Дом» или «Работа».</Text>
        )}
        {lists.map(l => (
          <Pressable
            key={l.id}
            style={styles.listRow}
            onPress={() => navigation.navigate('ReminderList', { listId: l.id, title: l.name })}
            onLongPress={() => setMenuList(l)}
          >
            <View style={[styles.dot, { backgroundColor: l.color }]} />
            <Text style={styles.listName}>{l.name}</Text>
            <Text style={styles.listCount}>{events.filter(e => e.listId === l.id && !e.completed).length}</Text>
            <ChevronRight color={colors.textSecondary} size={18} />
          </Pressable>
        ))}
        {lists.length > 0 && <Text style={styles.hint}>Удерживай список, чтобы изменить или удалить.</Text>}
      </ScrollView>

      <Pressable style={styles.fab} onPress={() => navigation.navigate('AddEvent')}>
        <Plus color={colors.background} size={20} />
        <Text style={styles.fabText}>Новое напоминание</Text>
      </Pressable>

      <Modal visible={menuList !== null} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={styles.modalBg} onPress={closeMenu}>
          <Pressable style={styles.modal} onPress={() => {}}>
            {menuList && (
              <>
                <View style={styles.menuHeader}>
                  <View style={[styles.dot, { backgroundColor: menuList.color }]} />
                  <Text style={styles.sectionTitle} numberOfLines={1}>
                    {menuList.name}
                  </Text>
                </View>
                {!confirmDelete ? (
                  <>
                    <Pressable
                      style={styles.menuButton}
                      onPress={() => {
                        const l = menuList;
                        closeMenu();
                        openEditList(l);
                      }}
                    >
                      <Pencil color={colors.textPrimary} size={18} />
                      <Text style={styles.menuText}>Изменить</Text>
                    </Pressable>
                    <Pressable style={styles.menuButton} onPress={() => setConfirmDelete(true)}>
                      <Trash2 color="#D64541" size={18} />
                      <Text style={[styles.menuText, { color: '#D64541' }]}>Удалить</Text>
                    </Pressable>
                    <Pressable onPress={closeMenu} style={styles.menuCancel}>
                      <Text style={styles.cancel}>Закрыть</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.confirmText}>
                      Список будет удалён. Напоминания из него останутся, но без списка.
                    </Text>
                    <View style={styles.modalButtons}>
                      <Pressable onPress={() => setConfirmDelete(false)} hitSlop={8}>
                        <Text style={styles.cancel}>Отмена</Text>
                      </Pressable>
                      <Pressable onPress={doDelete} hitSlop={8}>
                        <Text style={[styles.link, { color: '#D64541' }]}>Удалить</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={editing !== null} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <Text style={styles.sectionTitle}>{editing?.id ? 'Изменить список' : 'Новый список'}</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Название"
              placeholderTextColor={colors.textSecondary}
              autoFocus
              maxLength={40}
            />
            <View style={styles.colorRow}>
              {LIST_COLORS.map(c => (
                <Pressable
                  key={c}
                  onPress={() => setColor(c)}
                  style={[styles.swatch, { backgroundColor: c }, color === c && styles.swatchSelected]}
                />
              ))}
            </View>
            <View style={styles.modalButtons}>
              <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                <Text style={styles.cancel}>Отмена</Text>
              </Pressable>
              <Pressable onPress={submitList} hitSlop={8} disabled={!name.trim()}>
                <Text style={[styles.link, !name.trim() && { opacity: 0.4 }]}>Сохранить</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 110 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    width: '48.5%',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    gap: spacing.sm,
  },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tileIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tileCount: { ...typography.headline, color: colors.textPrimary },
  tileTitle: { ...typography.body, fontWeight: '600', color: colors.textSecondary },
  listsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  addList: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  link: { ...typography.body, color: colors.accent },
  empty: { ...typography.caption, color: colors.textSecondary },
  hint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  listName: { ...typography.body, color: colors.textPrimary, flex: 1 },
  listCount: { ...typography.body, color: colors.textSecondary },
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
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.lg },
  modal: { backgroundColor: colors.surface, borderRadius: 16, padding: spacing.lg, gap: spacing.md },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: spacing.md,
  },
  colorRow: { flexDirection: 'row', gap: spacing.sm },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: colors.textPrimary },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.lg },
  menuHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  menuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: spacing.md,
  },
  menuText: { ...typography.body, color: colors.textPrimary },
  menuCancel: { alignItems: 'center', paddingTop: spacing.xs },
  confirmText: { ...typography.body, color: colors.textSecondary },
  cancel: { ...typography.body, color: colors.textSecondary },
});
