import type { NativeWorkSchedule } from '../native/alarmCore';

export type SchedulesStackParamList = {
  SchedulesList: { justCreatedId?: string } | undefined;
  CreateSchedule: undefined;
  CustomPattern: undefined;
  ConfigureSchedule: {
    presetId: string;
    presetName: string;
    pattern: boolean[];
    existingSchedule?: NativeWorkSchedule; // если задан — режим редактирования
  };
};

export type RootTabParamList = {
  Calendar: undefined;
  Alarms: undefined;
  Schedules: undefined;
  Tools: undefined;
  Settings: undefined;
};

import type { NativeCustomEvent } from '../native/alarmCore';

export type CalendarStackParamList = {
  CalendarMain: undefined;
  AddEvent:
    | {
        existingEvent?: NativeCustomEvent;
        date?: string; // "YYYY-MM-DD" — подставить дату для нового события
        fromSchedule?: boolean; // после сохранения вернуться на вкладку «Графики»
      }
    | undefined;
};