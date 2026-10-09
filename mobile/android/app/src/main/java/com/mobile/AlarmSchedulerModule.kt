package com.mobile

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Нативный модуль системных будильников и связанных разрешений.
 * Отдельно от AlarmCoreModule (мост к Rust): там хранение данных,
 * здесь реальное планирование звонков через Android.
 */
class AlarmSchedulerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

        override fun getName() = "AlarmScheduler"

    /**
     * Открывает системный экран настроек, а если он недоступен на этом
     * телефоне, то страницу приложения, а если и она не открылась, то общие
     * настройки. Исключение наружу не выбрасывает: экран разрешений нельзя
     * пропустить, поэтому нажатие кнопки не должно ронять приложение.
     */
    private fun openSettingsSafely(primary: Intent) {
        val packageUri = Uri.parse("package:${reactApplicationContext.packageName}")
        val candidates = listOf(
            primary,
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(packageUri),
            Intent(Settings.ACTION_SETTINGS),
        )
        for (intent in candidates) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                reactApplicationContext.startActivity(intent)
                return
            } catch (e: Exception) {
                android.util.Log.d("AlarmDebug", "настройки не открылись (${intent.action}): ${e.message}")
            }
        }
    }

    // --- Разрешения ---------------------------------------------------------

    @ReactMethod
    fun hasExactAlarmPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val alarmManager = reactApplicationContext.getSystemService(AlarmManager::class.java)
            promise.resolve(alarmManager.canScheduleExactAlarms())
        } else {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun requestExactAlarmPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            openSettingsSafely(
                Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                    data = Uri.parse("package:${reactApplicationContext.packageName}")
                },
            )
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun hasFullScreenIntentPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= 34) {
            val notificationManager = reactApplicationContext.getSystemService(NotificationManager::class.java)
            promise.resolve(notificationManager.canUseFullScreenIntent())
        } else {
            promise.resolve(true)
        }
    }

        @ReactMethod
    fun requestFullScreenIntentPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= 34) {
            openSettingsSafely(
                Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                    data = Uri.parse("package:${reactApplicationContext.packageName}")
                },
            )
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        val powerManager = reactApplicationContext.getSystemService(PowerManager::class.java)
        promise.resolve(powerManager.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        openSettingsSafely(
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:${reactApplicationContext.packageName}")
            },
        )
        promise.resolve(null)
    }

    /**
     * Honor/Huawei держат свои настройки автозапуска и фоновой работы в
     * собственном менеджере, у которого нет публичного API. Пробуем открыть
     * его напрямую по известным компонентам; если не вышло — открываем
     * обычную страницу приложения в системных настройках.
     */
    @ReactMethod
    fun openOemBackgroundSettings(promise: Promise) {
                val candidates = listOf(
            // Экран «Запуск приложений» на твоей модели (подтверждён через adb).
            Intent().setComponent(
                ComponentName(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity",
                ),
            ),
            Intent().setComponent(
                ComponentName(
                    "com.huawei.systemmanager",
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
                ),
            ),
            // Запасные варианты для других моделей.
            Intent().setComponent(
                ComponentName(
                    "com.hihonor.systemmanager",
                    "com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
                ),
            ),
            // Общие настройки: дальше пользователь идёт вручную по инструкции.
            Intent(Settings.ACTION_SETTINGS),
        )

        for (intent in candidates) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                reactApplicationContext.startActivity(intent)
                break
            } catch (e: Exception) {
                // этот вариант недоступен на данном телефоне — пробуем следующий
            }
        }
        promise.resolve(null)
    }

    // --- Планирование -------------------------------------------------------

    

            /** Единая нативная синхронизация будильников (см. AlarmSyncer). */
    @ReactMethod
    fun syncAlarmsNow(promise: Promise) {
        try {
            AlarmSyncer.sync(reactApplicationContext, "приложение")
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SYNC_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun readJournal(promise: Promise) {
        promise.resolve(AlarmJournal.read(reactApplicationContext))
    }

    @ReactMethod
    fun clearJournal(promise: Promise) {
        AlarmJournal.clear(reactApplicationContext)
        promise.resolve(null)
    }

    // --- Служебное для онбординга -------------------------------------------

    @ReactMethod
    fun getManufacturer(promise: Promise) {
        promise.resolve(Build.MANUFACTURER.lowercase())
    }

    private fun prefs() =
        reactApplicationContext.getSharedPreferences("alarm_prefs", android.content.Context.MODE_PRIVATE)

    @ReactMethod
    fun getFlag(key: String, promise: Promise) {
        promise.resolve(prefs().getBoolean(key, false))
    }

    @ReactMethod
    fun setFlag(key: String, value: Boolean, promise: Promise) {
        prefs().edit().putBoolean(key, value).apply()
        promise.resolve(null)
    }

    /** Что откроется, если пользователь нажмёт на значок будильника в шторке. */
    private fun buildShowIntent(): PendingIntent {
        val launchIntent = Intent(reactApplicationContext, MainActivity::class.java)
        return PendingIntent.getActivity(
            reactApplicationContext, 0, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    /**
     * setAlarmClock вместо setExactAndAllowWhileIdle: Android и оболочки
     * вроде Magic UI считают такие будильники "настоящими будильниками"
     * (значок в статус-баре, исключение из Doze и фоновых ограничений).
     */
    private fun scheduleAlarmClock(requestCode: Int, triggerAtMillis: Long, intent: Intent) {
        val alarmManager = reactApplicationContext.getSystemService(AlarmManager::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            reactApplicationContext, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        alarmManager.setAlarmClock(
            AlarmManager.AlarmClockInfo(triggerAtMillis, buildShowIntent()),
            pendingIntent,
        )
    }

    @ReactMethod
    fun scheduleTestAlarm(delaySeconds: Double, promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, AlarmReceiver::class.java)
            val triggerAt = System.currentTimeMillis() + (delaySeconds.toLong() * 1000)
            scheduleAlarmClock(0, triggerAt, intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SCHEDULE_ERROR", e.message, e)
        }
    }

    /**
     * Ставит один будильник в конкретный "слот" (0..19) с его данными.
     * requestCode PendingIntent = номер слота, поэтому новый будильник
     * перезаписывает старый в том же слоте (FLAG_UPDATE_CURRENT).
     */
    @ReactMethod
    fun scheduleAlarmInSlot(slot: Double, triggerAtMillis: Double, alarmId: String, label: String, promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, AlarmReceiver::class.java).apply {
                putExtra("alarmId", alarmId)
                putExtra("label", label)
            }
            scheduleAlarmClock(slot.toInt(), triggerAtMillis.toLong(), intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SCHEDULE_ERROR", e.message, e)
        }
    }

    /** Отменяет будильник в конкретном слоте, если он там был. */
    @ReactMethod
    fun cancelSlot(slot: Double, promise: Promise) {
        try {
            val alarmManager = reactApplicationContext.getSystemService(AlarmManager::class.java)
            val intent = Intent(reactApplicationContext, AlarmReceiver::class.java)
            val pendingIntent = PendingIntent.getBroadcast(
                reactApplicationContext, slot.toInt(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            alarmManager.cancel(pendingIntent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("CANCEL_ERROR", e.message, e)
        }
    }
}