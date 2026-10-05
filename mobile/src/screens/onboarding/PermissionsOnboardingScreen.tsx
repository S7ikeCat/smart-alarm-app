import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, AppState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import {
  requestExactAlarmPermission,
  requestFullScreenIntentPermission,
  requestIgnoreBatteryOptimizations,
  openOemBackgroundSettings,
  setFlag,
} from '../../native/alarmScheduler';
import {
  checkAllPermissions,
  requestNotificationPermission,
  PermissionState,
} from '../../native/permissions';

type Step = {
  key: string;
  title: string;
  description: string;
  granted: boolean;
  actionLabel: string;
  onAction: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  recommended?: boolean;
};

type Props = { onFinish: () => void };

export function PermissionsOnboardingScreen({ onFinish }: Props) {
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<PermissionState | null>(null);

  const refresh = useCallback(() => {
    checkAllPermissions().then(setState);
  }, []);

  // Пользователь уходит в системные настройки и возвращается — при возврате
  // приложение снова становится активным, тогда и перепроверяем всё разом.
  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', status => {
      if (status === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  if (!state) {
    return <View style={styles.container} />;
  }

  const steps: Step[] = [
    {
      key: 'notifications',
      title: 'Уведомления',
      description: 'Пока звонит будильник, на экране висит уведомление с кнопками «Выключить» и «Отложить».',
      granted: state.notifications,
      actionLabel: 'Разрешить',
      onAction: () => {
        requestNotificationPermission().then(refresh);
      },
    },
    {
      key: 'exactAlarm',
      title: 'Точные будильники',
      description: 'Без этого Android может сдвинуть звонок на несколько минут, чтобы сэкономить батарею.',
      granted: state.exactAlarm,
      actionLabel: 'Разрешить',
      onAction: () => {
        requestExactAlarmPermission();
      },
    },
    {
      key: 'fullScreenIntent',
      title: 'Показ поверх блокировки',
      description: 'Чтобы экран будильника открывался сам, даже когда телефон заблокирован.',
      granted: state.fullScreenIntent,
      actionLabel: 'Разрешить',
      onAction: () => {
        requestFullScreenIntentPermission();
      },
    },
    {
      key: 'battery',
      title: 'Работа без ограничений батареи',
      description: 'Чтобы система не усыпляла приложение и будильник сработал вовремя, даже после долгой ночи.',
      granted: state.batteryOptimization,
      recommended: true,
      actionLabel: 'Разрешить',
      onAction: () => {
        requestIgnoreBatteryOptimizations();
      },
    },
  ];

  if (state.oemRequired) {
    steps.push({
      key: 'oem',
      title: 'Автозапуск и работа в фоне',
      description:
        'У твоего телефона есть собственная «экономия батареи», которая усыпляет приложения. ' +
        'Откроются настройки: найди это приложение, выключи «Управлять автоматически» и включи ' +
        '«Автозапуск», «Вторичный запуск» и «Работа в фоне». Потом вернись и нажми «Я всё включил».',
        granted: state.oemConfirmed,
        recommended: true,
        actionLabel: 'Открыть настройки приложения',
      onAction: () => {
        openOemBackgroundSettings();
      },
      secondaryLabel: 'Я всё включил',
      onSecondary: () => {
        setFlag('oemConfirmed', true).then(refresh);
      },
    });
  }

  const grantedCount = steps.filter(step => step.granted).length;

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Давай настроим будильник</Text>
        <Text style={styles.subtitle}>
          Чтобы будильник зазвонил вовремя, даже когда телефон заблокирован, нужно выдать несколько
          разрешений. Это займёт минуту.
        </Text>
        <Text style={styles.progress}>
          Готово {grantedCount} из {steps.length}
        </Text>

        {steps.map(step => (
          <View key={step.key} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.statusCircle, step.granted && styles.statusCircleDone]}>
                {step.granted && <Check color={colors.background} size={14} />}
              </View>
              <Text style={styles.cardTitle}>{step.title}</Text>
              {step.recommended && <Text style={styles.recommendedTag}>рекомендуется</Text>}
            </View>
            <Text style={styles.cardDescription}>{step.description}</Text>

            {!step.granted && (
              <View style={styles.cardButtons}>
                <Pressable style={styles.actionButton} onPress={step.onAction}>
                  <Text style={styles.actionButtonText}>{step.actionLabel}</Text>
                </Pressable>
                {step.secondaryLabel && step.onSecondary && (
                  <Pressable style={styles.secondaryButton} onPress={step.onSecondary}>
                    <Text style={styles.secondaryButtonText}>{step.secondaryLabel}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable
        style={[styles.continueButton, !state.requiredGranted && styles.continueButtonDisabled]}
        disabled={!state.requiredGranted}
          onPress={onFinish}
        >
          <Text style={styles.continueButtonText}>Продолжить</Text>
        </Pressable>
        <Pressable onPress={onFinish} hitSlop={8}>
          <Text style={styles.skipText}>Пропустить пока</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  title: { ...typography.headline, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  progress: { ...typography.caption, color: colors.accent, marginTop: spacing.md, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusCircleDone: { backgroundColor: colors.accentSecondary, borderColor: colors.accentSecondary },
  cardTitle: { ...typography.body, color: colors.textPrimary, fontWeight: '600', flex: 1 },
  recommendedTag: { ...typography.caption, fontSize: 11, color: colors.textSecondary },
  cardDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  cardButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  actionButtonText: { ...typography.caption, fontWeight: '600', color: colors.background },
  secondaryButton: {
    backgroundColor: colors.border,
    borderRadius: 10,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: { ...typography.caption, color: colors.textPrimary },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
    gap: spacing.md,
  },
  continueButton: {
    alignSelf: 'stretch',
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  continueButtonDisabled: { opacity: 0.4 },
  continueButtonText: { ...typography.body, fontWeight: '600', color: colors.background },
  skipText: { ...typography.caption, color: colors.textSecondary },
});