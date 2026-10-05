import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import {
  hasExactAlarmPermission,
  requestExactAlarmPermission,
  hasFullScreenIntentPermission,
  requestFullScreenIntentPermission,
  scheduleTestAlarm,
} from '../../native/alarmScheduler';

export function ToolsScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [hasFullScreenPermission, setHasFullScreenPermission] = useState<boolean | null>(null);

  useEffect(() => {
    hasExactAlarmPermission().then(setHasPermission);
    hasFullScreenIntentPermission().then(setHasFullScreenPermission);
  }, []);

  async function handleRequestPermission() {
    await requestExactAlarmPermission();
    setTimeout(() => {
      hasExactAlarmPermission().then(setHasPermission);
    }, 1000);
  }

  async function handleRequestFullScreenPermission() {
    await requestFullScreenIntentPermission();
    setTimeout(() => {
      hasFullScreenIntentPermission().then(setHasFullScreenPermission);
    }, 1000);
  }

  async function handleTestAlarm() {
    try {
      await scheduleTestAlarm(10);
      Alert.alert('Будильник поставлен', 'Сработает через 10 секунд — сверни приложение.');
    } catch (error) {
      Alert.alert('Не удалось поставить будильник', String(error));
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Инструменты</Text>

      <Text style={styles.status}>
        Разрешение на точные будильники:{' '}
        {hasPermission === null ? '...' : hasPermission ? 'есть ✅' : 'нет ❌'}
      </Text>

      {!hasPermission && (
        <Pressable style={styles.button} onPress={handleRequestPermission}>
          <Text style={styles.buttonText}>Запросить разрешение на точные будильники</Text>
        </Pressable>
      )}

      <Text style={styles.status}>
        Разрешение на полноэкранный показ:{' '}
        {hasFullScreenPermission === null ? '...' : hasFullScreenPermission ? 'есть ✅' : 'нет ❌'}
      </Text>

      {!hasFullScreenPermission && (
        <Pressable style={styles.button} onPress={handleRequestFullScreenPermission}>
          <Text style={styles.buttonText}>Запросить разрешение на полноэкранный показ</Text>
        </Pressable>
      )}

      <Pressable
        style={[styles.button, !hasPermission && styles.buttonDisabled]}
        disabled={!hasPermission}
        onPress={handleTestAlarm}
      >
        <Text style={styles.buttonText}>Тест: будильник через 10 сек</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    ...typography.headline,
    color: colors.textPrimary,
  },
  status: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { ...typography.body, fontWeight: '600', color: colors.background },
});