package com.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import java.io.File
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import uniffi.alarm_core.*

/**
 * Единственная реализация синхронизации будильников с AlarmManager.
 * Работает целиком в нативном коде и не зависит от JS.
 * Пул слотов 0..SLOT_COUNT-1; слот 9999 (отложенный будильник) не трогаем.
 */
object AlarmSyncer {
    const val SLOT_COUNT = 20
    private const val HORIZON_MONTHS = 2

    private class Candidate(val id: String, val label: String, val triggerAtMillis: Long)

    private val timeFormat = SimpleDateFormat("dd.MM HH:mm", Locale.US)

    private fun dbPath(context: Context): String =
        File(context.filesDir, "alarm_core.db").absolutePath

    /** "YYYY-MM-DD" + "HH:MM:SS" -> миллисекунды по локальному времени устройства. */
    private fun toMillis(date: String, time: String): Long {
        val (year, month, day) = date.split("-").map { it.toInt() }
        val parts = time.split(":")
        val hours = parts[0].toInt()
        val minutes = parts[1].toInt()
        val seconds = parts.getOrNull(2)?.substringBefore('.')?.toInt() ?: 0
        return Calendar.getInstance().apply {
            clear()
            set(year, month - 1, day, hours, minutes, seconds)
        }.timeInMillis
    }

    @Synchronized
    fun sync(context: Context, reason: String) {
        val path = dbPath(context)
        val now = System.currentTimeMillis()

        val scheduleNames = loadWorkSchedulesFfi(path).associate { it.id to it.name }
        val candidates = mutableListOf<Candidate>()

        for (instance in generateUpcomingAlarmsFfi(path, HORIZON_MONTHS.toUInt())) {
            if (instance.status != InstanceStatus.ACTIVE) continue
            val at = toMillis(instance.date, instance.timeLocal)
            if (at <= now) continue
            candidates.add(
                Candidate(
                    "schedule:${instance.id}",
                    scheduleNames[instance.scheduleId] ?: "Будильник",
                    at,
                ),
            )
        }

        for (event in loadCustomEventsFfi(path)) {
            if (!event.reminderEnabled) continue
            val at = toMillis(event.date, event.timeLocal)
            if (at <= now) continue
            candidates.add(Candidate("event:${event.id}", event.label, at))
        }

        val upcoming = candidates.sortedBy { it.triggerAtMillis }.take(SLOT_COUNT)

        for (slot in 0 until SLOT_COUNT) {
            val candidate = upcoming.getOrNull(slot)
            if (candidate != null) {
                scheduleInSlot(context, slot, candidate)
            } else {
                cancelSlot(context, slot)
            }
        }

        val nearest = upcoming.firstOrNull()
        val nearestText = if (nearest != null) {
            "ближайший ${timeFormat.format(Date(nearest.triggerAtMillis))} «${nearest.label}»"
        } else {
            "будильников нет"
        }
        AlarmJournal.log(context, "синхронизация ($reason): поставлено ${upcoming.size}, $nearestText")
        android.util.Log.d("AlarmDebug", "AlarmSyncer ($reason): поставлено ${upcoming.size}")
    }

    private fun scheduleInSlot(context: Context, slot: Int, candidate: Candidate) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra("alarmId", candidate.id)
            putExtra("label", candidate.label)
            putExtra("triggerAt", candidate.triggerAtMillis)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context, slot, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val showIntent = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        alarmManager.setAlarmClock(
            AlarmManager.AlarmClockInfo(candidate.triggerAtMillis, showIntent),
            pendingIntent,
        )
    }

    private fun cancelSlot(context: Context, slot: Int) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            context, slot, Intent(context, AlarmReceiver::class.java),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        ) ?: return
        alarmManager.cancel(pendingIntent)
        pendingIntent.cancel()
    }
}