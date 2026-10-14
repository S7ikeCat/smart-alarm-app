import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Switch,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Sofa, RotateCcw, Play, Square, Music, FolderOpen } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import {
  REST_TITLE_DEFAULT,
  REST_TITLE_LIMIT,
  loadRestTitle,
  saveRestTitle,
  RING_DEFAULTS,
  RingSettings,
  loadRingSettings,
  saveSnoozeMinutes,
  saveSnoozeLimit,
  saveFadeInSeconds,
  saveVibration,
  saveShakeDismiss,
  pickSystemRingtone,
  pickAudioFile,
  saveRingtone,
  previewRingtone,
  stopRingtonePreview,
  PickedRingtone,
} from '../../native/appSettings';

// Метка версии JS-кода: по ней видно, какая сборка реально стоит на телефоне.
const JS_BUILD = '14.10 · 13:25';

const SNOOZE_MINUTES_OPTIONS = [1, 3, 5, 10, 15];
const SNOOZE_LIMIT_OPTIONS = [1, 2, 3, 5, 0]; // 0 = без лимита
const FADE_OPTIONS = [0, 5, 10, 20, 30];

/** Ряд кнопок-вариантов: выбранная подсвечена. */
function ChipRow<T extends number>({
  options,
  value,
  label,
  onSelect,
}: {
  options: T[];
  value: T;
  label: (option: T) => string;
  onSelect: (option: T) => void;
}) {
  return (
    <View style={chipStyles.row}>
      {options.map(option => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            style={[chipStyles.chip, selected && chipStyles.chipSelected]}
            onPress={() => onSelect(option)}
          >
            <Text style={[chipStyles.chipText, selected && chipStyles.chipTextSelected]}>
              {label(option)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const chipStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minWidth: 52,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  chipText: { ...typography.body, color: colors.textPrimary },
  chipTextSelected: { color: colors.background, fontWeight: '600' },
});

export function SettingsScreen() {
  const [restTitle, setRestTitle] = useState(REST_TITLE_DEFAULT);
  const [savedTitle, setSavedTitle] = useState(REST_TITLE_DEFAULT);
  const [isSaving, setIsSaving] = useState(false);
  const busyRef = useRef(false);
  const [justSaved, setJustSaved] = useState(false);
  const [ring, setRing] = useState<RingSettings>(RING_DEFAULTS);
  const [isPreviewing, setIsPreviewing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadRestTitle().then(value => {
        setRestTitle(value);
        setSavedTitle(value);
      });
      loadRingSettings().then(setRing);
      // Уходя с экрана, гасим прослушивание.
      return () => {
        stopRingtonePreview().catch(() => {});
        setIsPreviewing(false);
      };
    }, []),
  );

  // Настройка применяется сразу: обновляем экран и пишем на диск.
  function change<K extends keyof RingSettings>(
    key: K,
    value: RingSettings[K],
    save: () => Promise<void>,
  ) {
    setRing(prev => ({ ...prev, [key]: value }));
    save().catch(error => Alert.alert('Не удалось сохранить настройку', String(error)));
  }

  async function applyRingtone(picked: PickedRingtone | null) {
    await stopRingtonePreview().catch(() => {});
    setIsPreviewing(false);
    await saveRingtone(picked);
    setRing(prev => ({
      ...prev,
      ringtoneUri: picked ? picked.uri : null,
      ringtoneTitle: picked ? picked.title : RING_DEFAULTS.ringtoneTitle,
    }));
  }

  async function handlePickSystem() {
    try {
      const picked = await pickSystemRingtone(ring.ringtoneUri);
      if (picked) await applyRingtone(picked);
    } catch (error) {
      Alert.alert('Не удалось выбрать мелодию', String(error));
    }
  }

  async function handlePickFile() {
    try {
      const picked = await pickAudioFile();
      if (picked) await applyRingtone(picked);
    } catch (error) {
      Alert.alert('Не удалось выбрать файл', String(error));
    }
  }

  async function handleTogglePreview() {
    try {
      if (isPreviewing) {
        await stopRingtonePreview();
        setIsPreviewing(false);
      } else {
        await previewRingtone(ring.ringtoneUri);
        setIsPreviewing(true);
        // нативная часть сама остановит через 8 секунд
        setTimeout(() => setIsPreviewing(false), 8000);
      }
    } catch (error) {
      setIsPreviewing(false);
      Alert.alert('Не удалось проиграть мелодию', String(error));
    }
  }

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const effective = restTitle.trim() || REST_TITLE_DEFAULT;
  const isChanged = effective !== savedTitle;
  const isDefault = effective === REST_TITLE_DEFAULT;

  async function persist(text: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsSaving(true);
    try {
      await saveRestTitle(text);
      const value = await loadRestTitle();
      setRestTitle(value);
      setSavedTitle(value);
      setJustSaved(true);
    } finally {
      busyRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Настройки</Text>

      <Text style={styles.sectionLabel}>Главный экран</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Надпись в выходной</Text>
        <Text style={styles.cardHint}>
          Видна на «Календаре» в день, когда по графику выходной.
        </Text>

        <View style={styles.preview}>
          <Sofa color={colors.restAccent} size={34} />
          <Text style={styles.previewText} numberOfLines={2}>
            {effective}
          </Text>
        </View>

        <TextInput
          style={styles.input}
          value={restTitle}
          onChangeText={text => setRestTitle(text.slice(0, REST_TITLE_LIMIT))}
          maxLength={REST_TITLE_LIMIT}
          placeholder={REST_TITLE_DEFAULT}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="done"
        />
        <Text style={styles.counter}>
          {restTitle.length}/{REST_TITLE_LIMIT}
        </Text>

        <Pressable
          style={[styles.primary, (!isChanged || isSaving) && styles.primaryDisabled]}
          disabled={!isChanged || isSaving}
          onPress={() => persist(restTitle)}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <Text style={styles.primaryText}>{justSaved ? 'Сохранено' : 'Сохранить'}</Text>
          )}
        </Pressable>

        {!isDefault && (
          <Pressable style={styles.outline} disabled={isSaving} onPress={() => persist('')}>
            <RotateCcw color={colors.accent} size={18} />
            <Text style={styles.outlineText}>Вернуть «{REST_TITLE_DEFAULT}»</Text>
          </Pressable>
        )}
      </View>

      <Text style={[styles.sectionLabel, styles.sectionGap]}>Звонок</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Мелодия</Text>
        <View style={styles.melodyRow}>
          <Music color={colors.textSecondary} size={20} />
          <Text style={styles.melodyTitle} numberOfLines={1}>
            {ring.ringtoneTitle}
          </Text>
        </View>
        <View style={styles.buttonRow}>
          <Pressable style={styles.smallOutline} onPress={handleTogglePreview}>
            {isPreviewing ? (
              <Square color={colors.accent} size={16} />
            ) : (
              <Play color={colors.accent} size={16} />
            )}
            <Text style={styles.smallOutlineText}>{isPreviewing ? 'Стоп' : 'Прослушать'}</Text>
          </Pressable>
          <Pressable style={styles.smallOutline} onPress={handlePickSystem}>
            <Music color={colors.accent} size={16} />
            <Text style={styles.smallOutlineText}>Из системных</Text>
          </Pressable>
          <Pressable style={styles.smallOutline} onPress={handlePickFile}>
            <FolderOpen color={colors.accent} size={16} />
            <Text style={styles.smallOutlineText}>Свой файл</Text>
          </Pressable>
        </View>
        {ring.ringtoneUri !== null && (
          <Pressable style={styles.resetLink} onPress={() => applyRingtone(null)}>
            <RotateCcw color={colors.textSecondary} size={14} />
            <Text style={styles.resetLinkText}>Вернуть стандартную</Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.card, styles.cardGap]}>
        <Text style={styles.cardTitle}>Плавное нарастание громкости</Text>
        <Text style={styles.cardHint}>Звук начинается тихо и доходит до полной громкости за выбранное время.</Text>
        <ChipRow
          options={FADE_OPTIONS}
          value={ring.fadeInSeconds}
          label={o => (o === 0 ? 'Выкл' : `${o} с`)}
          onSelect={o => change('fadeInSeconds', o, () => saveFadeInSeconds(o))}
        />
      </View>

      <View style={[styles.card, styles.cardGap]}>
        <Text style={styles.cardTitle}>Отложить</Text>
        <Text style={styles.cardHint}>Через сколько минут будильник прозвонит снова.</Text>
        <ChipRow
          options={SNOOZE_MINUTES_OPTIONS}
          value={ring.snoozeMinutes}
          label={o => `${o} мин`}
          onSelect={o => change('snoozeMinutes', o, () => saveSnoozeMinutes(o))}
        />
        <Text style={[styles.cardHint, styles.hintGap]}>
          Сколько раз можно отложить, чтобы не проспать насовсем.
        </Text>
        <ChipRow
          options={SNOOZE_LIMIT_OPTIONS}
          value={ring.snoozeLimit}
          label={o => (o === 0 ? 'Без лимита' : `${o}`)}
          onSelect={o => change('snoozeLimit', o, () => saveSnoozeLimit(o))}
        />
      </View>

      <View style={[styles.card, styles.cardGap, styles.switchCard]}>
        <View style={styles.switchText}>
          <Text style={styles.cardTitle}>Вибрация</Text>
          <Text style={styles.cardHintTight}>Вибрировать, пока звонит будильник.</Text>
        </View>
        <Switch
          value={ring.vibration}
          onValueChange={v => change('vibration', v, () => saveVibration(v))}
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={colors.textPrimary}
        />
      </View>

      <View style={[styles.card, styles.cardGap]}>
        <View style={styles.switchCard}>
          <View style={styles.switchText}>
            <Text style={styles.cardTitle}>Выключать встряской</Text>
            <Text style={styles.cardHintTight}>
              Чтобы выключить будильник, один раз встряхни телефон. Отложить можно как обычно.
            </Text>
          </View>
          <Switch
            value={ring.shakeDismiss}
            onValueChange={v => change('shakeDismiss', v, () => saveShakeDismiss(v))}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.textPrimary}
          />
        </View>
      </View>

      <Text style={styles.buildStamp}>Сборка интерфейса: {JS_BUILD}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xl * 2 },
  title: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.lg },
  sectionLabel: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: spacing.md },
  cardTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  cardHint: { ...typography.caption, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.md },
  preview: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  previewText: { fontSize: 22, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  counter: { ...typography.caption, color: colors.textSecondary, textAlign: 'right', marginTop: 4, marginBottom: spacing.sm },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryDisabled: { opacity: 0.4 },
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
  buildStamp: { ...typography.caption, fontSize: 11, color: colors.textSecondary, opacity: 0.4, textAlign: 'center', marginTop: spacing.xl },
  sectionGap: { marginTop: spacing.lg },
  cardGap: { marginTop: spacing.md },
  hintGap: { marginTop: spacing.md },
  cardHintTight: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  melodyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  melodyTitle: { ...typography.body, color: colors.textPrimary, flex: 1 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  smallOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 12,
  },
  smallOutlineText: { ...typography.caption, fontWeight: '600', color: colors.accent },
  resetLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, minHeight: 32 },
  resetLinkText: { ...typography.caption, color: colors.textSecondary },
  switchCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switchText: { flex: 1, paddingRight: spacing.md },
});
