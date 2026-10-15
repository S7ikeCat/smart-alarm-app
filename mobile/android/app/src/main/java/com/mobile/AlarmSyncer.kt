package com.mobile

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
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
 * Источники: будильники графиков, дополнительные будильники, события.
 * Будильники с одной и той же минутой сливаются в один звонок.
 */
object AlarmSyncer {
    const val SLOT_COUNT = 64
    private const val HORIZON_MONTHS = 2

    // Обычные напоминания (уведомления) — свой пул, чтобы не мешать будильникам.
    private const val NOTIFY_SLOT_BASE = 1000
    private const val NOTIFY_SLOT_COUNT = 64

    /** eventKeys — «idНапоминания|дата», чтобы отметить их выполненными, когда прозвонят. */
    private class Candidate(
        val id: String,
        val label: String,
        val triggerAtMillis: Long,
        val eventKeys: List<String> = emptyList(),
    )

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

        // Напоминания с учётом повторов: срочные звонят будильником,
        // обычные приходят уведомлением.
        val notifications = mutableListOf<Candidate>()
        for (o in generateReminderOccurrencesFfi(path, HORIZON_MONTHS.toUInt())) {
            val at = toMillis(o.date, o.timeLocal)
            if (at <= now) continue
            val key = "${o.eventId}|${o.date}"
            if (o.urgent) {
                candidates.add(Candidate("event:${o.eventId}:${o.date}", o.label, at, listOf(key)))
            } else {
                notifications.add(Candidate("reminder:${o.eventId}:${o.date}", o.label, at, listOf(key)))
            }
        }

        for (extra in generateExtraAlarmsFfi(path, HORIZON_MONTHS.toUInt(), java.util.TimeZone.getDefault().id)) {
            val at = toMillis(extra.date, extra.timeLocal)
            if (at <= now) continue
            candidates.add(
                Candidate(
                    "extra:${extra.alarmId}:${extra.date}",
                    extra.label.ifBlank { "Будильник" },
                    at,
                ),
            )
        }

        // Одинаковое время -> один звонок с объединённой подписью, иначе два
        // будильника в одну минуту толкали бы друг друга в сервисе.
        val upcoming = candidates
            .sortedBy { it.triggerAtMillis }
            .groupBy { it.triggerAtMillis }
            .map { (at, group) ->
                Candidate(
                    (group.firstOrNull { !it.id.startsWith("event:") } ?: group.first()).id,
                    group.map { it.label }.distinct().joinToString(" · "),
                    at,
                    group.flatMap { it.eventKeys },
                )
            }
            .take(SLOT_COUNT)

        for (slot in 0 until SLOT_COUNT) {
            val candidate = upcoming.getOrNull(slot)
            if (candidate != null) {
                scheduleInSlot(context, slot, candidate)
            } else {
                cancelSlot(context, slot)
            }
        }

        // Пул уведомлений: то же время -> одно уведомление не склеиваем, их можно показать подряд.
        val notifyUpcoming = notifications.sortedBy { it.triggerAtMillis }.take(NOTIFY_SLOT_COUNT)
        for (i in 0 until NOTIFY_SLOT_COUNT) {
            val c = notifyUpcoming.getOrNull(i)
            if (c != null) scheduleNotification(context, NOTIFY_SLOT_BASE + i, c)
            else cancelNotification(context, NOTIFY_SLOT_BASE + i)
        }

        val nearest = upcoming.firstOrNull()
        val nearestText = if (nearest != null) {
            "ближайший ${timeFormat.format(Date(nearest.triggerAtMillis))} «${nearest.label}»"
        } else {
            "будильников нет"
        }
        AlarmJournal.log(context, "синхронизация ($reason): поставлено ${upcoming.size}, уведомлений ${notifyUpcoming.size}, $nearestText")
        android.util.Log.d("AlarmDebug", "AlarmSyncer ($reason): поставлено ${upcoming.size}")
    }

    private fun scheduleInSlot(context: Context, slot: Int, candidate: Candidate) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra("alarmId", candidate.id)
            putExtra("label", candidate.label)
            putExtra("triggerAt", candidate.triggerAtMillis)
            putExtra("eventKeys", candidate.eventKeys.joinToString(","))
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

    private fun scheduleNotification(context: Context, requestCode: Int, candidate: Candidate) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            putExtra("label", candidate.label)
            putExtra("eventKeys", candidate.eventKeys.joinToString(","))
            putExtra("triggerAt", candidate.triggerAtMillis)
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarmManager.canScheduleExactAlarms()
        if (canExact) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.triggerAtMillis, pendingIntent)
        } else {
            alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, candidate.triggerAtMillis, pendingIntent)
        }
    }

    private fun cancelNotification(context: Context, requestCode: Int) {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            context, requestCode, Intent(context, ReminderReceiver::class.java),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
        ) ?: return
        alarmManager.cancel(pendingIntent)
        pendingIntent.cancel()
    }

    /**
     * Сработавшие напоминания отмечаются выполненными: разовые уходят в «Завершено»,
     * повторяющиеся переезжают на следующую дату. keys — «id|дата».
     */
    fun completeEvents(context: Context, keys: List<String>) {
        val path = dbPath(context)
        for (key in keys) {
            val parts = key.split("|")
            if (parts.size != 2) continue
            try {
                completeReminderFfi(path, parts[0], parts[1])
            } catch (e: Exception) {
                AlarmJournal.log(context, "ОШИБКА отметки напоминания: ${e.message}")
            }
        }
    }
}
