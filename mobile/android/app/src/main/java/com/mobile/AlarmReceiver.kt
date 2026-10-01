package com.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Срабатывает, когда AlarmManager будит систему на заданное время. Сам по
 * себе ничего не "звонит" — создаёт full-screen уведомление, которое Android
 * либо сразу разворачивает в AlarmRingActivity (если экран заблокирован),
 * либо показывает как обычное heads-up уведомление (если телефон уже
 * разблокирован) — так ведут себя и штатные будильники.
 */
class AlarmReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
        android.util.Log.d("AlarmDebug", "AlarmReceiver.onReceive сработал")
        val channelId = "alarm_channel"

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Будильники",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Уведомления о срабатывании будильника"
                setBypassDnd(true)
            }
            notificationManager.createNotificationChannel(channel)
        }

        val alarmId = intent.getStringExtra("alarmId") ?: ""
        val label = intent.getStringExtra("label") ?: "Будильник"

        val fullScreenIntent = Intent(context, AlarmRingActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("alarmId", alarmId)
            putExtra("label", label)
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            context, 0, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(label)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setAutoCancel(true)
            .build()

                notificationManager.notify(1, notification)
        android.util.Log.d("AlarmDebug", "уведомление отправлено")
    }
}