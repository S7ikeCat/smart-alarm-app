package com.mobile

import android.content.Context
import android.content.SharedPreferences
import android.media.RingtoneManager
import android.net.Uri

/**
 * Настройки звонка. Хранятся в SharedPreferences как строки — те же ключи
 * читает и пишет React-часть (appSettings.ts), поэтому звонок работает
 * по ним даже при убитом приложении.
 */
object AlarmSettings {
    const val PREFS = "smart_alarm_settings"

    const val KEY_SNOOZE_MINUTES = "snooze_minutes"
    const val KEY_SNOOZE_LIMIT = "snooze_limit"
    const val KEY_FADE_IN = "fade_in_seconds"
    const val KEY_VIBRATION = "vibration"
    const val KEY_RINGTONE_URI = "ringtone_uri"
    const val KEY_RINGTONE_TITLE = "ringtone_title"

    // Служебные ключи счётчика снузов (не настройки пользователя).
    private const val KEY_SNOOZE_ALARM_ID = "_snooze_alarm_id"
    private const val KEY_SNOOZE_COUNT = "_snooze_count"

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Через сколько минут повторить сигнал. По умолчанию 5. */
    fun snoozeMinutes(context: Context): Int {
        val value = prefs(context).getString(KEY_SNOOZE_MINUTES, null)?.toIntOrNull() ?: 5
        return value.coerceIn(1, 60)
    }

    /** Сколько раз можно отложить. 0 = без лимита. По умолчанию 3. */
    fun snoozeLimit(context: Context): Int {
        val value = prefs(context).getString(KEY_SNOOZE_LIMIT, null)?.toIntOrNull() ?: 3
        return value.coerceIn(0, 20)
    }

    /** За сколько секунд громкость нарастает до полной. 0 = сразу на полную. */
    fun fadeInSeconds(context: Context): Int {
        val value = prefs(context).getString(KEY_FADE_IN, null)?.toIntOrNull() ?: 10
        return value.coerceIn(0, 60)
    }

    fun vibrationEnabled(context: Context): Boolean =
        prefs(context).getString(KEY_VIBRATION, null) != "0"

    /** Выбранная мелодия или null — тогда играет системный будильник. */
    fun ringtoneUriString(context: Context): String? =
        prefs(context).getString(KEY_RINGTONE_URI, null)?.takeIf { it.isNotBlank() }

    fun defaultAlarmUri(context: Context): Uri =
        RingtoneManager.getActualDefaultRingtoneUri(context, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

    // --- Счётчик снузов -------------------------------------------------------
    // Сервис после каждого откладывания закрывается, поэтому счётчик
    // хранится на диске. Он привязан к id будильника: у другого будильника
    // счёт начинается с нуля.

    fun snoozeCountFor(context: Context, alarmId: String): Int {
        val p = prefs(context)
        if (p.getString(KEY_SNOOZE_ALARM_ID, null) != alarmId) return 0
        return p.getInt(KEY_SNOOZE_COUNT, 0)
    }

    fun saveSnoozeCount(context: Context, alarmId: String, count: Int) {
        prefs(context).edit()
            .putString(KEY_SNOOZE_ALARM_ID, alarmId)
            .putInt(KEY_SNOOZE_COUNT, count)
            .apply()
    }

    fun clearSnoozeCount(context: Context) {
        prefs(context).edit()
            .remove(KEY_SNOOZE_ALARM_ID)
            .remove(KEY_SNOOZE_COUNT)
            .apply()
    }

    /** Сколько снузов осталось: -1 = без лимита, 0 = больше нельзя. */
    fun snoozesLeft(context: Context, alarmId: String): Int {
        val limit = snoozeLimit(context)
        if (limit == 0) return -1
        return (limit - snoozeCountFor(context, alarmId)).coerceAtLeast(0)
    }
}
