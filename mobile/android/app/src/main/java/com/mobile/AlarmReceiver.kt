package com.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Срабатывает, когда AlarmManager будит систему. Сначала запускает сервис
 * звонка (чтобы ничего не задерживать), потом пополняет запас будильников,
 * чтобы он не иссякал, даже если приложение никто не открывает.
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val label = intent.getStringExtra("label") ?: "Будильник"
        val planned = intent.getLongExtra("triggerAt", 0L)
        val delayText = if (planned > 0) {
            ", опоздание ${(System.currentTimeMillis() - planned) / 1000} с"
        } else {
            ""
        }
        AlarmJournal.log(context, "приёмник: сработал «$label»$delayText")

        val serviceIntent = Intent(context, AlarmService::class.java).apply {
            action = AlarmService.ACTION_START
            putExtra("alarmId", intent.getStringExtra("alarmId") ?: "")
            putExtra("label", label)
        }
        try {
            ContextCompat.startForegroundService(context, serviceIntent)
        } catch (e: Exception) {
            AlarmJournal.log(context, "ОШИБКА запуска сервиса звонка: ${e.message}")
        }

        // Сработавший будильник уже в прошлом, синхронизация его пропустит и
        // добавит в конец пула следующий — запас остаётся полным.
        val pending = goAsync()
        Thread {
            try {
                AlarmSyncer.sync(context.applicationContext, "после звонка")
            } catch (e: Exception) {
                AlarmJournal.log(context, "ОШИБКА синхронизации после звонка: ${e.message}")
            } finally {
                pending.finish()
            }
        }.start()
    }
}