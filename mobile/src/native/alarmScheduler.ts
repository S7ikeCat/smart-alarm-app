import { NativeModules } from 'react-native';

const { AlarmScheduler } = NativeModules;

export function hasExactAlarmPermission(): Promise<boolean> {
  return AlarmScheduler.hasExactAlarmPermission();
}

export function requestExactAlarmPermission(): Promise<void> {
    return AlarmScheduler.requestExactAlarmPermission();
  }
  
  export function hasFullScreenIntentPermission(): Promise<boolean> {
    return AlarmScheduler.hasFullScreenIntentPermission();
  }
  
  export function requestFullScreenIntentPermission(): Promise<void> {
    return AlarmScheduler.requestFullScreenIntentPermission();
  }

  export function isIgnoringBatteryOptimizations(): Promise<boolean> {
    return AlarmScheduler.isIgnoringBatteryOptimizations();
  }
  
  export function requestIgnoreBatteryOptimizations(): Promise<void> {
    return AlarmScheduler.requestIgnoreBatteryOptimizations();
  }
  
  export function openOemBackgroundSettings(): Promise<void> {
    return AlarmScheduler.openOemBackgroundSettings();
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

  export function getManufacturer(): Promise<string> {
    return AlarmScheduler.getManufacturer();
  }
  
  export function getFlag(key: string): Promise<boolean> {
    return AlarmScheduler.getFlag(key);
  }
  
  export function setFlag(key: string, value: boolean): Promise<void> {
    return AlarmScheduler.setFlag(key, value);
  }

  export function syncAlarmsNow(): Promise<void> {
    return AlarmScheduler.syncAlarmsNow();
  }

  export function readJournal(): Promise<string> {
    return AlarmScheduler.readJournal();
  }
  
  export function clearJournal(): Promise<void> {
    return AlarmScheduler.clearJournal();
  }