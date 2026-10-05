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
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat

/**
 * Сервис звонка: именно он играет мелодию и вибрирует, а не экран.
 * Поэтому звонок не зависит от того, пустит ли оболочка (Magic UI)
 * полноэкранную Activity поверх блокировки. Управлять будильником можно
 * и с экрана, и с кнопок в самом уведомлении.
 */
class AlarmService : Service() {
    private var mediaPlayer: MediaPlayer? = null
    private var alarmId = ""
    private var alarmLabel = "Будильник"
    private val handler = Handler(Looper.getMainLooper())
    private val autoStopRunnable = Runnable { dismissAlarm() }

    companion object {
        const val ACTION_START = "com.mobile.ALARM_START"
        const val ACTION_STOP = "com.mobile.ALARM_STOP"
        const val ACTION_SNOOZE = "com.mobile.ALARM_SNOOZE"
        const val ACTION_DISMISSED = "com.mobile.ALARM_DISMISSED"

        private const val CHANNEL_ID = "alarm_ring_channel"
        private const val NOTIFICATION_ID = 1

        // Отдельный номер слота для отложенного будильника, вне диапазона
        // 0..19, который использует синхронизация (alarmSync.ts).
        private const val SNOOZE_REQUEST_CODE = 9999
        private const val SNOOZE_MINUTES = 5

        // Страховка: если пользователь не отреагировал, не звоним бесконечно.
        private const val AUTO_STOP_MS = 10 * 60 * 1000L
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> dismissAlarm()
            ACTION_SNOOZE -> {
                scheduleSnooze()
                dismissAlarm()
            }
            else -> startAlarm(intent)
        }
        return START_NOT_STICKY
    }

    private fun startAlarm(intent: Intent?) {
        alarmId = intent?.getStringExtra("alarmId") ?: ""
        alarmLabel = intent?.getStringExtra("label") ?: "Будильник"
        android.util.Log.d("AlarmDebug", "AlarmService: старт звонка '$alarmLabel'")

        createChannelIfNeeded()
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        android.util.Log.d("AlarmDebug", "AlarmService: startForeground выполнен")

        try {
            startRinging()
        } catch (e: Exception) {
            android.util.Log.d("AlarmDebug", "AlarmService: startRinging УПАЛ: ${e.message}")
        }
        try {
            startVibrating()
        } catch (e: Exception) {
            android.util.Log.d("AlarmDebug", "AlarmService: startVibrating УПАЛ: ${e.message}")
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

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(alarmLabel)
            .setContentText("Нажми, чтобы открыть")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(activityPending)
            .setFullScreenIntent(activityPending, true)
            .addAction(0, "Выключить", servicePending(ACTION_STOP, 1))
            .addAction(0, "Отложить", servicePending(ACTION_SNOOZE, 2))
            .build()
    }

    private fun startRinging() {
        val alarmUri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

        mediaPlayer = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build(),
            )
            setDataSource(this@AlarmService, alarmUri)
            isLooping = true
            prepare()
            start()
        }
    }

    private fun startVibrating() {
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

    /** Ставит тот же будильник заново через SNOOZE_MINUTES. */
    private fun scheduleSnooze() {
        try {
            val alarmManager = getSystemService(AlarmManager::class.java)
            val snoozeIntent = Intent(this, AlarmReceiver::class.java).apply {
                putExtra("alarmId", alarmId)
                putExtra("label", alarmLabel)
            }
            val pendingIntent = PendingIntent.getBroadcast(
                this, SNOOZE_REQUEST_CODE, snoozeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val showIntent = PendingIntent.getActivity(
                this, 0, Intent(this, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val triggerAt = System.currentTimeMillis() + SNOOZE_MINUTES * 60_000L
            alarmManager.setAlarmClock(AlarmManager.AlarmClockInfo(triggerAt, showIntent), pendingIntent)
            android.util.Log.d("AlarmDebug", "AlarmService: отложено до $triggerAt")
        } catch (e: Exception) {
            android.util.Log.d("AlarmDebug", "AlarmService: snooze УПАЛ: ${e.message}")
        }
    }

    /** Гасит звонок, убирает уведомление, просит закрыться открытый экран. */
    private fun dismissAlarm() {
        handler.removeCallbacks(autoStopRunnable)
        stopRingingAndVibrating()
        stopForeground(STOP_FOREGROUND_REMOVE)
        sendBroadcast(Intent(ACTION_DISMISSED).setPackage(packageName))
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacks(autoStopRunnable)
        mediaPlayer?.release()
        super.onDestroy()
    }
}