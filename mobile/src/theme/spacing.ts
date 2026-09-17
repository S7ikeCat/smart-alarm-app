import { useWindowDimensions } from 'react-native';

/**
 * Базовая сетка отступов — кратно 4, стандарт для RN-приложений.
 * Использовать вместо чисел "с потолка" в margin/padding.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

/**
 * Хук для адаптивности под разные размеры экранов — вместо фиксированных
 * пикселей в критичных местах (например, размер главной цифры времени)
 * используем масштаб относительно ширины экрана. 375 — условная "базовая"
 * ширина (iPhone SE/большинство Android-компактов), от неё считаем множитель.
 */
export function useResponsiveScale() {
  const { width } = useWindowDimensions();
  return width / 375;
}