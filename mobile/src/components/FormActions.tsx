import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Check, Trash2, X } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

type Props = {
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  busy?: boolean;
};

/** Кнопки формы одним рядом, без подписей: ✕ отмена, 🗑 удалить (если есть что), ✓ сохранить. */
export function FormActions({ onSave, onCancel, onDelete, busy }: Props) {
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.square}
        onPress={onCancel}
        disabled={busy}
        accessibilityLabel="Отмена"
        hitSlop={4}
      >
        <X color={colors.textSecondary} size={24} />
      </Pressable>
      {onDelete && (
        <Pressable
          style={[styles.square, styles.danger]}
          onPress={onDelete}
          disabled={busy}
          accessibilityLabel="Удалить"
          hitSlop={4}
        >
          <Trash2 color="#D64541" size={22} />
        </Pressable>
      )}
      <Pressable
        style={[styles.save, busy && { opacity: 0.5 }]}
        onPress={onSave}
        disabled={busy}
        accessibilityLabel="Сохранить"
      >
        <Check color={colors.background} size={28} strokeWidth={2.6} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  square: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  danger: { borderWidth: 1.5, borderColor: 'rgba(214,69,65,0.6)' },
  save: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
