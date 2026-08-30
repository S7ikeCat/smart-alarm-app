/**
 * Экраны внутри вкладки "Графики" — здесь стек-навигация,
 * потому что есть переход список → создание графика.
 */
export type SchedulesStackParamList = {
    SchedulesList: undefined;
    CreateSchedule: undefined;
  };
  
  /**
   * Экраны нижних вкладок. У "Графики" значение — не undefined,
   * а вложенный стек-навигатор (см. SchedulesStackParamList выше).
   */
  export type RootTabParamList = {
    Calendar: undefined;
    Schedules: undefined;
    Tools: undefined;
    Settings: undefined;
  };