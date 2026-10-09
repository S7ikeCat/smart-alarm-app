import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { RotateCcw } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { BottomSheet } from './BottomSheet';
import { TimeStepper } from './TimeStepper';
import { ExtraAlarmForm } from './ExtraAlarmForm';
import {
  NativeAlarmTimeOverride,
  NativeCustomEvent,
  NativeExtraAlarm,
  NativeExtraAlarmInstance,
  NativeWorkSchedule,
  deleteAlarmTimeOverride,
  saveAlarmTimeOverride,
} from '../native/alarmCore';
import { addMinutesToTime, formatKeyLong, shortTime } from '../utils/timeUtils';

export type DayDetails = {
  dateKey: string; // "YYYY-MM-DD"
  hasScheduleAlarms: boolean; // в этот день по графику есть будильники
  extras: NativeExtraAlarmInstance[];
  events: NativeCustomEvent[];
};

type Mode =
  | { type: 'list' }
  | { type: 'ruleTime'; ruleId: string; time: string; baseTime: string; hadOverride: boolean }
  | { type: 'extra'; alarm: NativeExtraAlarm | null };

type Props = {
  visible: boolean;
  details: DayDetails | null;
  schedule: NativeWorkSchedule | null;
  timeOverrides: NativeAlarmTimeOverride[];
  extraAlarms: NativeExtraAlarm[];
  onClose: () => void;
  onChanged: () => void;
  onOpenEvent: (event: NativeCustomEvent) => void;
};

/** Шторка с подробностями дня: будильники графика (время можно поменять на этот день), дополнительные, события. */
export function DaySheet({
  visible,
  details,
  schedule,
  timeOverrides,
  extraAlarms,
  onClose,
  onChanged,
  onOpenEvent,
}: Props) {
  const [mode, setMode] = useState<Mode>({ type: 'list' });

  useEffect(() => {
    if (visible) setMode({ type: 'list' });
  }, [visible, details?.dateKey]);

  if (!details) {
    return <BottomSheet visible={false} onClose={onClose}>{null}</BottomSheet>;
  }

  const { dateKey } = details;

  function backToList() {
    setMode({ type: 'list' });
  }

  function handleChanged() {
    backToList();
    onChanged();
  }

  async function saveRuleTime(ruleId: string, time: string) {
    if (!schedule) return;
    try {
      await saveAlarmTimeOverride({ scheduleId: schedule.id, date: dateKey, ruleId, timeLocal: time });
      handleChanged();
    } catch (error) {
      Alert.alert('Не удалось сохранить время', String(error));
    }
  }

  async function resetRuleTime(ruleId: string) {
    if (!schedule) return;
    try {
      await deleteAlarmTimeOverride(schedule.id, dateKey, ruleId);
      handleChanged();
    } catch (error) {
      Alert.alert('Не удалось сбросить время', String(error));
    }
  }

  function renderList() {
    const rules = schedule?.alarms ?? [];
    return (
      <View>
        <Text style={styles.title}>{formatKeyLong(dateKey)}</Text>

        {details!.hasScheduleAlarms && schedule && rules.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>По графику «{schedule.name}»</Text>
            {rules.map((rule, index) => {
              const base = addMinutesToTime(schedule.shiftStartTime, -rule.offsetMinutes);
              const override = timeOverrides.find(o => o.date === dateKey && o.ruleId === rule.id);
              const time = override?.timeLocal ?? base;
              return (
                <Pressable
                  key={rule.id}
                  style={styles.row}
                  onPress={() =>
                    setMode({
                      type: 'ruleTime',
                      ruleId: rule.id,
                      time,
                      baseTime: base,
                      hadOverride: !!override,
                    })
                  }
                >
                  <Text style={styles.rowTime}>{shortTime(time)}</Text>
                  <Text style={styles.rowMeta}>
                    {rules.length > 1 ? `Будильник ${index + 1}` : 'Будильник'}
                  </Text>
                  {override && (
                    <View style={styles.changedTag}>
                      <Text style={styles.changedTagText}>было {shortTime(base)}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
            <Text style={styles.hint}>Нажми на время, чтобы поменять его только на этот день.</Text>
          </View>
        )}

        {details!.extras.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Дополнительные</Text>
            {details!.extras.map(extra => {
              const full = extraAlarms.find(a => a.id === extra.alarmId) ?? null;
              return (
                <Pressable
                  key={`${extra.alarmId}-${extra.timeLocal}`}
                  style={styles.row}
                  onPress={() => full && setMode({ type: 'extra', alarm: full })}
                >
                  <Text style={styles.rowTime}>{shortTime(extra.timeLocal)}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {extra.label || 'Будильник'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {details!.events.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>События</Text>
            {details!.events.map(event => (
              <Pressable key={event.id} style={styles.row} onPress={() => onOpenEvent(event)}>
                <View style={[styles.dot, { backgroundColor: event.color }]} />
                <Text style={styles.rowTime}>{shortTime(event.timeLocal)}</Text>
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {event.label}
                  {event.reminderEnabled ? '' : ' · без напоминания'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {!details!.hasScheduleAlarms && details!.extras.length === 0 && details!.events.length === 0 && (
          <Text style={styles.empty}>В этот день будильников нет.</Text>
        )}

        <Pressable style={styles.primary} onPress={() => setMode({ type: 'extra', alarm: null })}>
          <Text style={styles.primaryText}>+ Будильник на этот день</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={onClose}>
          <Text style={styles.secondaryText}>Закрыть</Text>
        </Pressable>
      </View>
    );
  }

  function renderRuleTime(m: Extract<Mode, { type: 'ruleTime' }>) {
    return (
      <View>
        <Text style={styles.title}>Время на {formatKeyLong(dateKey)}</Text>
        <Text style={styles.hint}>Меняется только этот день, остальные не затронуты.</Text>
        <TimeStepper
          value={m.time}
          onChange={time => setMode({ ...m, time })}
        />
        <Pressable
          style={styles.primary}
          onPress={() => {
            // Выбрали ровно обычное время — это не изменение, просто убираем запись.
            if (m.time.slice(0, 5) === m.baseTime.slice(0, 5)) {
              if (m.hadOverride) resetRuleTime(m.ruleId);
              else backToList();
            } else {
              saveRuleTime(m.ruleId, m.time);
            }
          }}
        >
          <Text style={styles.primaryText}>Сохранить</Text>
        </Pressable>
        {m.hadOverride && (
          <Pressable style={styles.outline} onPress={() => resetRuleTime(m.ruleId)}>
            <RotateCcw color={colors.accent} size={18} />
            <Text style={styles.outlineText}>Вернуть обычное время · {shortTime(m.baseTime)}</Text>
          </Pressable>
        )}
        <Pressable style={styles.secondary} onPress={backToList}>
          <Text style={styles.secondaryText}>Назад</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {mode.type === 'list' && renderList()}
      {mode.type === 'ruleTime' && renderRuleTime(mode)}
      {mode.type === 'extra' && (
        <ExtraAlarmForm
          alarm={mode.alarm}
          fixedDate={dateKey}
          onDone={handleChanged}
          onCancel={backToList}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.headline, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.md },
  section: { marginBottom: spacing.md },
  sectionTitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rowTime: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryText: { ...typography.body, fontWeight: '600', color: colors.background },
  outline: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  outlineText: { ...typography.body, fontWeight: '600', color: colors.accent },
  changedTag: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  changedTagText: { ...typography.caption, color: colors.accent },
  secondary: { paddingVertical: spacing.md, alignItems: 'center' },
  secondaryText: { ...typography.body, color: colors.textSecondary },
});
