import { NativeModules } from 'react-native';

const { AlarmScheduler } = NativeModules;

export function hasExactAlarmPermission(): Promise<boolean> {
  return AlarmScheduler.hasExactAlarmPermission();
}

export function requestExactAlarmPermission(): Promise<void> {
    return AlarmScheduler.requestExactAlarmPermission();
  }
  
  export function scheduleTestAlarm(delaySeconds: number): Promise<void> {
    return AlarmScheduler.scheduleTestAlarm(delaySeconds);
  }
  
  export function scheduleAlarmInSlot(
    slot: number,
    triggerAtMillis: number,
    alarmId: string,
    label: string,
  ): Promise<void> {
    return AlarmScheduler.scheduleAlarmInSlot(slot, triggerAtMillis, alarmId, label);
  }
  
  export function cancelSlot(slot: number): Promise<void> {
    return AlarmScheduler.cancelSlot(slot);
  }