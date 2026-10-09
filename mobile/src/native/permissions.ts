import { PermissionsAndroid, Platform, Linking } from 'react-native';
import {
  hasExactAlarmPermission,
  hasFullScreenIntentPermission,
  isIgnoringBatteryOptimizations,
  getManufacturer,
  getFlag,
} from './alarmScheduler';

// Производители со своей агрессивной "экономией батареи", которая убивает
// фоновые приложения поверх стандартного Android. Для остальных телефонов
// шаг про автозапуск вообще не показываем.
const AGGRESSIVE_OEMS = ['huawei', 'honor', 'xiaomi', 'redmi', 'poco', 'oppo', 'realme', 'vivo', 'oneplus'];

export type PermissionState = {
  notifications: boolean;
  exactAlarm: boolean;
  fullScreenIntent: boolean;
  batteryOptimization: boolean;
  oemRequired: boolean;
  oemConfirmed: boolean;
  requiredGranted: boolean;
  allGranted: boolean;
};

async function hasNotificationPermission(): Promise<boolean> {
  // До Android 13 разрешение на уведомления выдано по умолчанию.
  if (Platform.OS !== 'android' || (Platform.Version as number) < 33) return true;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
}

export async function requestNotificationPermission(): Promise<void> {
  if ((Platform.Version as number) < 33) return;
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  // Если пользователь дважды отказал, системный диалог больше не покажется —
  // ведём в настройки приложения, где можно включить вручную.
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    await Linking.openSettings();
  }
}

export async function checkAllPermissions(): Promise<PermissionState> {
  const [notifications, exactAlarm, fullScreenIntent, batteryOptimization, manufacturer] =
    await Promise.all([
      hasNotificationPermission(),
      hasExactAlarmPermission(),
      hasFullScreenIntentPermission(),
      isIgnoringBatteryOptimizations(),
      getManufacturer(),
    ]);

  const oemRequired = AGGRESSIVE_OEMS.some(name => manufacturer.includes(name));
  const oemConfirmed = oemRequired ? await getFlag('oemConfirmed') : true;

  return {
    notifications,
    exactAlarm,
    fullScreenIntent,
    batteryOptimization,
    oemRequired,
    oemConfirmed,
            // oemConfirmed уже true на телефонах без агрессивной оболочки.
    requiredGranted: notifications && exactAlarm && fullScreenIntent && oemConfirmed,
        allGranted:
          notifications && exactAlarm && fullScreenIntent && batteryOptimization && oemConfirmed,
      };
}