package com.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Android стирает все будильники приложения при перезагрузке телефона и при
 * обновлении самого приложения. Кроме того, они устаревают при смене времени,
 * даты или часового пояса. Этот приёмник ставит их заново без участия JS.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val reason = when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> "перезагрузка"
            Intent.ACTION_MY_PACKAGE_REPLACED -> "обновление приложения"
            // Будильники стоят на конкретные моменты времени, а «07:00» — это время
            // на часах телефона. Если часы или пояс поменялись, моменты надо пересчитать.
            Intent.ACTION_TIME_CHANGED -> "время на телефоне изменено"
            Intent.ACTION_DATE_CHANGED -> "дата сменилась"
            Intent.ACTION_TIMEZONE_CHANGED -> "часовой пояс изменён"
            else -> return
        }
        AlarmJournal.log(context, "получено событие: $reason")

        // Java запоминает часовой пояс при запуске процесса; после его смены
        // сбрасываем запомненное значение, иначе пересчёт пошёл бы по старому поясу.
        java.util.TimeZone.setDefault(null)

        val pending = goAsync()
        Thread {
            try {
                AlarmSyncer.sync(context.applicationContext, reason)
            } catch (e: Exception) {
                AlarmJournal.log(context, "ОШИБКА синхронизации ($reason): ${e.message}")
            } finally {
                pending.finish()
            }
        }.start()
    }
}