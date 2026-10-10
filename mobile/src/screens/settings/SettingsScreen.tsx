import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Sofa, RotateCcw } from 'lucide-react-native';
import { colors } from '../../theme/colors';
import { typography } from '../../theme/typography';
import { spacing } from '../../theme/spacing';
import {
  REST_TITLE_DEFAULT,
  REST_TITLE_LIMIT,
  loadRestTitle,
  saveRestTitle,
} from '../../native/appSettings';

export function SettingsScreen() {
  const [restTitle, setRestTitle] = useState(REST_TITLE_DEFAULT);
  const [savedTitle, setSavedTitle] = useState(REST_TITLE_DEFAULT);
  const [isSaving, setIsSaving] = useState(false);
  const busyRef = useRef(false);
  const [justSaved, setJustSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadRestTitle().then(value => {
        setRestTitle(value);
        setSavedTitle(value);
      });
    }, []),
  );

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
});
