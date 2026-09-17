export type SchedulesStackParamList = {
  SchedulesList: undefined;
  CreateSchedule: undefined;
  CustomPattern: undefined;
  ConfigureSchedule: {
    presetId: string;
    presetName: string;
    pattern: boolean[];
  };
};

export type RootTabParamList = {
  Calendar: undefined;
  Schedules: undefined;
  Tools: undefined;
  Settings: undefined;
};