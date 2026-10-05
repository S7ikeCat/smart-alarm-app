package com.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

/**
 * Срабатывает, когда AlarmManager будит систему. Сам ничего не показывает:
 * передаёт эстафету сервису звонка, который играет мелодию и держит уведомление.
 */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        android.util.Log.d("AlarmDebug", "AlarmReceiver.onReceive сработал")
        val serviceIntent = Intent(context, AlarmService::class.java).apply {
            action = AlarmService.ACTION_START
            putExtra("alarmId", intent.getStringExtra("alarmId") ?: "")
            putExtra("label", intent.getStringExtra("label") ?: "Будильник")
        }
        try {
            ContextCompat.startForegroundService(context, serviceIntent)
        } catch (e: Exception) {
            android.util.Log.d("AlarmDebug", "не удалось запустить AlarmService: ${e.message}")
        }
    }
}