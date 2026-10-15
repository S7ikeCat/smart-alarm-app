import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { colors } from '../theme/colors';
import { typography } from '../theme/typography';
import { spacing } from '../theme/spacing';
import { BottomSheet } from './BottomSheet';

export type SelectOption<T> = { value: T; label: string; color?: string };

type Props<T> = {
  title: string;
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Иконка слева от названия (необязательно). */
  icon?: React.ReactNode;
  /** 'sheet' — шторка снизу (на экранах); 'dialog' — окошко по центру (внутри других шторок). */
  variant?: 'sheet' | 'dialog';
  /** Поле поиска сверху списка (для длинных списков, например городов). */
  searchable?: boolean;
  /** Что показать справа вместо подписи выбранного варианта. */
  valueText?: string;
  /** Подпись под названием внутри окна выбора. */
  footnote?: string;
  /** Фон строки: 'surface' на тёмном экране, 'background' внутри карточки. */
  tone?: 'surface' | 'background';
};

function OptionList<T>({
  options,
  value,
  onPick,
}: {
  options: SelectOption<T>[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} style={styles.optRow} onPress={() => onPick(o.value)}>
            {o.color ? <View style={[styles.dot, { backgroundColor: o.color }]} /> : null}
            <Text style={[styles.optText, on && styles.optTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
            {on && <Check color={colors.accent} size={20} />}
          </Pressable>
        );
      })}
    </>
  );
}

/** Строка «Название — значение ›»; по нажатию открывается красивый выбор вместо кирпичиков-кнопок. */
export function SelectRow<T>({
  title,
  options,
  value,
  onChange,
  icon,
  variant = 'sheet',
  searchable = false,
  valueText,
  footnote,
  tone = 'surface',
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const current = options.find(o => o.value === value);

  const shown = useMemo(() => {
    const q = query.toLowerCase().replace(/ё/g, 'е').trim();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().replace(/ё/g, 'е').includes(q));
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function pick(v: T) {
    onChange(v);
    close();
  }

  return (
    <>
      <Pressable
        style={[styles.row, tone === 'surface' && { backgroundColor: colors.surface }]}
        onPress={() => setOpen(true)}
      >
        {icon}
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {current?.color ? <View style={[styles.dot, { backgroundColor: current.color }]} /> : null}
        <Text style={styles.rowValue} numberOfLines={1}>
          {valueText ?? current?.label ?? ''}
        </Text>
        <ChevronRight color={colors.textSecondary} size={18} />
      </Pressable>

      {variant === 'sheet' ? (
        <BottomSheet visible={open} onClose={close}>
          <Text style={styles.sheetTitle}>{title}</Text>
          {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
          <OptionList options={options} value={value} onPick={pick} />
        </BottomSheet>
      ) : (
        <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
          <Pressable style={styles.dialogBg} onPress={close}>
            <Pressable style={styles.dialog} onPress={() => {}}>
              <Text style={styles.sheetTitle}>{title}</Text>
              {searchable && (
                <TextInput
                  style={styles.search}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Поиск"
                  placeholderTextColor={colors.textSecondary}
                />
              )}
              <ScrollView
                style={{ maxHeight: 360 }}
                contentContainerStyle={searchable ? { paddingRight: spacing.lg } : undefined}
                keyboardShouldPersistTaps="handled"
              >
                <OptionList options={shown} value={value} onPick={pick} />
                {shown.length === 0 && <Text style={styles.footnote}>Ничего не найдено.</Text>}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
  },
  rowTitle: { ...typography.body, color: colors.textPrimary, flex: 1 },
  rowValue: { ...typography.body, color: colors.textSecondary, maxWidth: '55%' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  sheetTitle: { ...typography.headline, color: colors.textPrimary, marginBottom: spacing.md },
  footnote: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  optRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14 },
  optText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  optTextOn: { color: colors.accent, fontWeight: '600' },
  dialogBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialog: { backgroundColor: colors.surface, borderRadius: 20, padding: spacing.lg },
  search: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
});
