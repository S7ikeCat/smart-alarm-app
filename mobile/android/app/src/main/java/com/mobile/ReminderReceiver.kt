package com.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Обычное (не срочное) напоминание: просто уведомление в назначенное время.
 * Срочные звонят будильником через AlarmReceiver. После показа напоминание
 * отмечается выполненным, а пул синхронизируется заново.
 */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val label = intent.getStringExtra("label") ?: "Напоминание"
        val keys = (intent.getStringExtra("eventKeys") ?: "").split(",").filter { it.isNotBlank() }
        AlarmJournal.log(context, "напоминание: «$label»")

        showNotification(context, label)

        val pending = goAsync()
        Thread {
            try {
                AlarmSyncer.completeEvents(context.applicationContext, keys)
                AlarmSyncer.sync(context.applicationContext, "после напоминания")
            } catch (e: Exception) {
                AlarmJournal.log(context, "ОШИБКА после напоминания: ${e.message}")
            } finally {
                pending.finish()
            }
        }.start()
    }

    private fun showNotification(context: Context, label: String) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            AlarmJournal.log(context, "уведомления выключены — напоминание «$label» не показано")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL_ID, "Напоминания", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Обычные напоминания"
            }
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(label)
            .setContentText("Напоминание")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        try {
            NotificationManagerCompat.from(context).notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
        } catch (e: SecurityException) {
            AlarmJournal.log(context, "нет разрешения на уведомления: ${e.message}")
        }
    }

    companion object {
        private const val CHANNEL_ID = "reminders_channel"
    }
}
