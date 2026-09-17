/**
 * Единая шкала типографики — используем везде вместо магических чисел
 * в стилях, чтобы весь текст в приложении был согласован по размеру/весу.
 */
export const typography = {
    displayLarge: { fontSize: 56, fontWeight: '700' as const },
    headline: { fontSize: 24, fontWeight: '700' as const },
    body: { fontSize: 16, fontWeight: '400' as const },
    caption: { fontSize: 13, fontWeight: '400' as const },
  };