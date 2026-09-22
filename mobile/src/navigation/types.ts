import type { NativeWorkSchedule } from '../native/alarmCore';

export type SchedulesStackParamList = {
  SchedulesList: undefined;
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
  Schedules: undefined;
  Tools: undefined;
  Settings: undefined;
};