export type GridCell = { date: Date; inCurrentMonth: boolean };

export function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function isWorkDayByPattern(date: Date, startDate: Date, pattern: boolean[]) {
  const cycleLen = pattern.length;
  const diffDays = Math.floor(
    (startOfDay(date).getTime() - startOfDay(startDate).getTime()) / 86400000,
  );
  if (diffDays < 0) return false;
  const dayInCycle = diffDays % cycleLen;
  return pattern[dayInCycle];
}

export function chunkIntoWeeks(cells: GridCell[]): GridCell[][] {
  const weeks: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/**
 * Строит сетку месяца с ISO-неделями (Пн...Вс). Дополняет ведущие и
 * замыкающие ячейки днями соседних месяцев (приглушённые, некликабельные),
 * чтобы сетка всегда была ровной — без пустых "дыр".
 */
export function buildMonthGrid(monthDate: Date): GridCell[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  // JS getDay(): Вс=0, Пн=1, ..., Сб=6. Переводим так, чтобы Пн=0 ... Вс=6.
  const firstWeekdayIndex = (firstDayOfMonth.getDay() + 6) % 7;

  const grid: GridCell[] = [];

  for (let i = firstWeekdayIndex - 1; i >= 0; i--) {
    grid.push({ date: new Date(year, month - 1, daysInPrevMonth - i), inCurrentMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    grid.push({ date: new Date(year, month, d), inCurrentMonth: true });
  }

  while (grid.length % 7 !== 0) {
    const lastDate = grid[grid.length - 1].date;
    grid.push({ date: addDays(lastDate, 1), inCurrentMonth: false });
  }

  return grid;
}

export function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function formatMonth(date: Date) {
  return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

export const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];