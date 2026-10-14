package com.mobile

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Сервис звонка: именно он играет мелодию и вибрирует, а не экран.
 * Каждый шаг пишется в AlarmJournal.
 */
class AlarmService : Service() {
    private var mediaPlayer: MediaPlayer? = null
    private var alarmId = ""
    private var alarmLabel = "Будильник"
    private val handler = Handler(Looper.getMainLooper())
    private val autoStopRunnable = Runnable {
        dismissAlarm("автоостановка: никто не отреагировал за 10 минут")
    }
    private var fadeRunnable: Runnable? = null

    companion object {
        const val ACTION_START = "com.mobile.ALARM_START"
        const val ACTION_STOP = "com.mobile.ALARM_STOP"
        const val ACTION_SNOOZE = "com.mobile.ALARM_SNOOZE"
        const val ACTION_DISMISSED = "com.mobile.ALARM_DISMISSED"

        private const val CHANNEL_ID = "alarm_ring_channel"
        private const val NOTIFICATION_ID = 1

        // Номер слота отложенного будильника — вне диапазона 0..19 синхронизации.
        private const val SNOOZE_REQUEST_CODE = 9999

        // Страховка: если пользователь не отреагировал, не звоним бесконечно.
        private const val AUTO_STOP_MS = 10 * 60 * 1000L
    }

    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.US)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> dismissAlarm("выключен пользователем")
            ACTION_SNOOZE -> {
                if (AlarmSettings.snoozesLeft(this, alarmId) == 0) {
                    AlarmJournal.log(this, "сервис: откладывать больше нельзя, лимит исчерпан")
                } else {
                    scheduleSnooze()
                    dismissAlarm("отложен", clearSnoozeCount = false)
                }
            }
            else -> startAlarm(intent)
        }
        return START_NOT_STICKY
    }

    private fun startAlarm(intent: Intent?) {
        alarmId = intent?.getStringExtra("alarmId") ?: ""
        alarmLabel = intent?.getStringExtra("label") ?: "Будильник"
        AlarmJournal.log(this, "сервис: звонок начался «$alarmLabel»")

        createChannelIfNeeded()
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        try {
            startRinging()
        } catch (e: Exception) {
            AlarmJournal.log(this, "ОШИБКА мелодии: ${e.message}")
        }
        try {
            startVibrating()
        } catch (e: Exception) {
            AlarmJournal.log(this, "ОШИБКА вибрации: ${e.message}")
        }

        handler.postDelayed(autoStopRunnable, AUTO_STOP_MS)
    }

    private fun createChannelIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Звонок будильника",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Уведомление, пока звонит будильник"
                setSound(null, null) // мелодию играем сами, не уведомление
                enableVibration(false)
                setBypassDnd(true)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val activityIntent = Intent(this, AlarmRingActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("alarmId", alarmId)
            putExtra("label", alarmLabel)
            putExtra("snoozesLeft", AlarmSettings.snoozesLeft(this@AlarmService, alarmId))
            putExtra("snoozeMinutes", AlarmSettings.snoozeMinutes(this@AlarmService))
        }
        val activityPending = PendingIntent.getActivity(
            this, 0, activityIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        fun servicePending(action: String, requestCode: Int): PendingIntent =
            PendingIntent.getService(
                this, requestCode,
                Intent(this, AlarmService::class.java).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(alarmLabel)
            .setContentText(if (AlarmSettings.shakeRequired(this)) "Нажми и встряхни телефон" else "Нажми, чтобы открыть")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(activityPending)
            .setFullScreenIntent(activityPending, true)

        // Режим «встряхни» — выключить из шторки нельзя, только на экране звонка.
        if (!AlarmSettings.shakeRequired(this)) {
            builder.addAction(0, "Выключить", servicePending(ACTION_STOP, 1))
        }

        // Лимит снузов исчерпан — кнопку «Отложить» не показываем вовсе.
        if (AlarmSettings.snoozesLeft(this, alarmId) != 0) {
            builder.addAction(0, "Отложить", servicePending(ACTION_SNOOZE, 2))
        }
        return builder.build()
    }

    private fun startRinging() {
        val fadeSeconds = AlarmSettings.fadeInSeconds(this)
        val chosen = AlarmSettings.ringtoneUriString(this)
        var player: MediaPlayer? = null

        // Сначала пробуем выбранную мелодию; если файл пропал или не читается —
        // не остаёмся без звука, а играем системную.
        if (chosen != null) {
            try {
                player = createPlayer(android.net.Uri.parse(chosen), fadeSeconds)
            } catch (e: Exception) {
                AlarmJournal.log(this, "ОШИБКА выбранной мелодии (${e.message}), играем стандартную")
            }
        }
        val ready: MediaPlayer = player ?: createPlayer(AlarmSettings.defaultAlarmUri(this), fadeSeconds)
        mediaPlayer = ready
        ready.start()
        startFadeIn(fadeSeconds)
    }

    private fun createPlayer(uri: android.net.Uri, fadeSeconds: Int): MediaPlayer {
        val player = MediaPlayer()
        try {
            player.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            player.setDataSource(this, uri)
            player.isLooping = true
            if (fadeSeconds > 0) player.setVolume(0f, 0f)
            player.prepare()
            return player
        } catch (e: Exception) {
            player.release()
            throw e
        }
    }

    /** Плавно поднимает громкость от нуля до полной за fadeSeconds. */
    private fun startFadeIn(fadeSeconds: Int) {
        if (fadeSeconds <= 0) return
        val startedAt = SystemClock.elapsedRealtime()
        val runnable = object : Runnable {
            override fun run() {
                val player = mediaPlayer ?: return
                val progress = ((SystemClock.elapsedRealtime() - startedAt) / (fadeSeconds * 1000f))
                    .coerceIn(0f, 1f)
                val volume = progress * progress // тихий старт, потом быстрее
                try {
                    player.setVolume(volume, volume)
                } catch (e: Exception) {
                    return
                }
                if (progress < 1f) handler.postDelayed(this, 150)
            }
        }
        fadeRunnable = runnable
        handler.post(runnable)
    }

    private fun startVibrating() {
        if (!AlarmSettings.vibrationEnabled(this)) return
        val pattern = longArrayOf(0, 500, 500)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vibratorManager = getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager
            vibratorManager.defaultVibrator.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } else {
            @Suppress("DEPRECATION")
            val vibrator = getSystemService(VIBRATOR_SERVICE) as Vibrator
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0))
        }
    }

    private fun stopRingingAndVibrating() {
        fadeRunnable?.let { handler.removeCallbacks(it) }
        fadeRunnable = null
        mediaPlayer?.stop()
        mediaPlayer?.release()
        mediaPlayer = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator.cancel()
        } else {
            @Suppress("DEPRECATION")
            (getSystemService(VIBRATOR_SERVICE) as Vibrator).cancel()
        }
    }

    /** Ставит тот же будильник заново через выбранное в настройках число минут. */
    private fun scheduleSnooze() {
        try {
            val minutes = AlarmSettings.snoozeMinutes(this)
            val alarmManager = getSystemService(AlarmManager::class.java)
            val triggerAt = System.currentTimeMillis() + minutes * 60_000L
            val snoozeIntent = Intent(this, AlarmReceiver::class.java).apply {
                putExtra("alarmId", alarmId)
                putExtra("label", alarmLabel)
                putExtra("triggerAt", triggerAt)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                this, SNOOZE_REQUEST_CODE, snoozeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val showIntent = PendingIntent.getActivity(
                this, 0, Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showIntent), pendingIntent)
            val used = AlarmSettings.snoozeCountFor(this, alarmId) + 1
            AlarmSettings.saveSnoozeCount(this, alarmId, used)
            AlarmJournal.log(this, "сервис: отложено на $minutes мин (снуз №$used), снова в ${timeFormat.format(Date(triggerAt))}")
        } catch (e: Exception) {
            AlarmJournal.log(this, "ОШИБКА откладывания: ${e.message}")
        }
    }

    /** Гасит звонок, убирает уведомление, просит закрыться открытый экран. */
    private fun dismissAlarm(reason: String, clearSnoozeCount: Boolean = true) {
        AlarmJournal.log(this, "сервис: звонок завершён — $reason")
        // Выключили совсем — следующий раз счёт снузов начнётся с нуля.
        if (clearSnoozeCount) AlarmSettings.clearSnoozeCount(this)
        handler.removeCallbacks(autoStopRunnable)
        stopRingingAndVibrating()
        stopForeground(STOP_FOREGROUND_REMOVE)
        sendBroadcast(Intent(ACTION_DISMISSED).setPackage(packageName))
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacks(autoStopRunnable)
        fadeRunnable?.let { handler.removeCallbacks(it) }
        mediaPlayer?.release()
        super.onDestroy()
    }
}