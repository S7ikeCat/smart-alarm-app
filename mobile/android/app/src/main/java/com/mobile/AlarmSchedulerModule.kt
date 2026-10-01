package com.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

/**
 * Отдельный нативный модуль именно для системных будильников (AlarmManager) —
 * сознательно не смешиваем с AlarmCoreModule, который занимается мостом к
 * Rust-ядру. Это две разные ответственности: одна — хранение данных,
 * другая — реальное планирование звонков через Android.
 */
class AlarmSchedulerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AlarmScheduler"

    @ReactMethod
    fun hasExactAlarmPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val alarmManager = reactApplicationContext.getSystemService(AlarmManager::class.java)
            promise.resolve(alarmManager.canScheduleExactAlarms())
        } else {
            // На версиях Android ниже 12 это разрешение не существует как отдельное —
            // точные будильники разрешены по умолчанию.
            promise.resolve(true)
        }
    }

        @ReactMethod
    fun requestExactAlarmPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                data = Uri.parse("package:${reactApplicationContext.packageName}")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            reactApplicationContext.startActivity(intent)
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun scheduleTestAlarm(delaySeconds: Double, promise: Promise) {
        try {
            val alarmManager = reactApplicationContext.getSystemService(AlarmManager::class.java)
            val intent = Intent(reactApplicationContext, AlarmReceiver::class.java)
            val pendingIntent = PendingIntent.getBroadcast(
                reactApplicationContext, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val triggerAt = System.currentTimeMillis() + (delaySeconds.toLong() * 1000)
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SCHEDULE_ERROR", e.message, e)
        }
    }

    /**
     * Ставит один будильник в конкретный "слот" (0..19) с его реальными
     * данными — именно это AlarmReceiver/AlarmRingActivity потом прочитают
     * из Intent, чтобы знать, какому будильнику принадлежит звонок.
     * requestCode у PendingIntent = номер слота — это и есть тот самый
     * механизм, которым мы "перезаписываем" старый будильник в этом слоте
     * новым при каждой синхронизации (FLAG_UPDATE_CURRENT).
     */
    @ReactMethod
    fun scheduleAlarmInSlot(slot: Double, triggerAtMillis: Double, alarmId: String, label: String, promise: Promise) {
        try {
            val alarmManager = reactApplicationContext.getSystemService(AlarmManager::class.java)
            val intent = Intent(reactApplicationContext, AlarmReceiver::class.java).apply {
                putExtra("alarmId", alarmId)
                putExtra("label", label)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                reactApplicationContext, slot.toInt(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                triggerAtMillis.toLong(),
                pendingIntent,
            )
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