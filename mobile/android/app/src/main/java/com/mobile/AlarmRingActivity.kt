package com.mobile

import android.app.Activity
import android.app.KeyguardManager
import android.graphics.Color
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Полноэкранный экран звонка будильника — свой, но стилизованный под
 * привычный системный паттерн (крупное время по центру, кнопки снизу).
 * Фаза 1: минимальная версия для проверки всей цепочки — время +
 * "Выключить" + "Отложить" (пока без реальной логики откладывания).
 */
class AlarmRingActivity : Activity() {
    private var mediaPlayer: MediaPlayer? = null

        override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        android.util.Log.d("AlarmDebug", "AlarmRingActivity.onCreate начался")

        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            val keyguardManager = getSystemService(KEYGUARD_SERVICE) as KeyguardManager
            keyguardManager.requestDismissKeyguard(this, null)
        }

                android.util.Log.d("AlarmDebug", "перед startRinging")
        try {
            startRinging()
            android.util.Log.d("AlarmDebug", "startRinging успешно")
        } catch (e: Exception) {
            android.util.Log.d("AlarmDebug", "startRinging УПАЛ: ${e.message}")
        }

        try {
            startVibrating()
            android.util.Log.d("AlarmDebug", "startVibrating успешно")
        } catch (e: Exception) {
            android.util.Log.d("AlarmDebug", "startVibrating УПАЛ: ${e.message}")
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#1A1614"))
        }

                val label = intent.getStringExtra("label") ?: "Будильник"

        val timeText = TextView(this).apply {
            text = android.text.format.DateFormat.getTimeFormat(this@AlarmRingActivity)
                .format(java.util.Date())
            textSize = 56f
            setTextColor(Color.parseColor("#F5EDE4"))
            gravity = Gravity.CENTER
        }

        val labelText = TextView(this).apply {
            text = label
            textSize = 18f
            setTextColor(Color.parseColor("#6B5D52"))
            gravity = Gravity.CENTER
        }

        val stopButton = Button(this).apply {
            text = "Выключить"
            setOnClickListener { stopAndFinish() }
        }

        val snoozeButton = Button(this).apply {
            text = "Отложить на 5 мин"
            setOnClickListener { stopAndFinish() } // TODO: реальное откладывание — следующая фаза
        }

        layout.addView(timeText)
        layout.addView(labelText)
        layout.addView(stopButton)
        layout.addView(snoozeButton)
        setContentView(layout)
        android.util.Log.d("AlarmDebug", "setContentView выполнен, onCreate завершён")
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
            setDataSource(this@AlarmRingActivity, alarmUri)
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

    private fun stopAndFinish() {
        mediaPlayer?.stop()
        mediaPlayer?.release()
        mediaPlayer = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator.cancel()
        } else {
            @Suppress("DEPRECATION")
            (getSystemService(VIBRATOR_SERVICE) as Vibrator).cancel()
        }
        finish()
    }

    override fun onDestroy() {
        mediaPlayer?.release()
        super.onDestroy()
    }
}