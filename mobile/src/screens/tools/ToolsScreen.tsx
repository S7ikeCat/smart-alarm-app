import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import {
  hasExactAlarmPermission,
  requestExactAlarmPermission,
  hasFullScreenIntentPermission,
  requestFullScreenIntentPermission,
  scheduleTestAlarm,
  readJournal,
  clearJournal,
} from '../../native/alarmScheduler';

export function ToolsScreen() {
  const [hasExact, setHasExact] = useState<boolean | null>(null);
  const [hasFullScreen, setHasFullScreen] = useState<boolean | null>(null);
  const [journal, setJournal] = useState('');

  const refresh = useCallback(() => {
    hasExactAlarmPermission().then(setHasExact);
    hasFullScreenIntentPermission().then(setHasFullScreen);
    readJournal()
      .then(text => setJournal(text.split('\n').reverse().join('\n'))) // новые сверху
      .catch(error => setJournal(`Не удалось прочитать журнал: ${error}`));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function handleTestAlarm() {
    try {
      await scheduleTestAlarm(10);
      Alert.alert('Будильник поставлен', 'Сработает через 10 секунд — сверни приложение.');
    } catch (error) {
      Alert.alert('Не удалось поставить будильник', String(error));
    }
  }

  async function handleClearJournal() {
    await clearJournal();
    refresh();
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Инструменты</Text>

      <Text style={styles.status}>
        Точные будильники: {hasExact === null ? '...' : hasExact ? 'есть ✅' : 'нет ❌'}
        {'\n'}
        Показ поверх блокировки: {hasFullScreen === null ? '...' : hasFullScreen ? 'есть ✅' : 'нет ❌'}
      </Text>

      {hasExact === false && (
        <Pressable style={styles.button} onPress={() => requestExactAlarmPermission()}>
          <Text style={styles.buttonText}>Разрешить точные будильники</Text>
        </Pressable>
      )}
      {hasFullScreen === false && (
        <Pressable style={styles.button} onPress={() => requestFullScreenIntentPermission()}>
          <Text style={styles.buttonText}>Разрешить показ поверх блокировки</Text>
        </Pressable>
      )}

      <Pressable style={styles.button} onPress={handleTestAlarm}>
        <Text style={styles.buttonText}>Тест: будильник через 10 сек</Text>
      </Pressable>

      <View style={styles.journalHeader}>
        <Text style={styles.sectionTitle}>Журнал будильника</Text>
        <View style={styles.journalButtons}>
          <Pressable onPress={refresh} hitSlop={8}>
            <Text style={styles.link}>Обновить</Text>
          </Pressable>
          <Pressable onPress={handleClearJournal} hitSlop={8}>
            <Text style={styles.link}>Очистить</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.journal}>{journal}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.headline, color: colors.textPrimary },
  status: { ...typography.body, color: colors.textSecondary },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  buttonText: { ...typography.body, fontWeight: '600', color: colors.background },
  journalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  sectionTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  journalButtons: { flexDirection: 'row', gap: spacing.md },
  link: { ...typography.caption, color: colors.accent },
  journal: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.sm,
  },
});