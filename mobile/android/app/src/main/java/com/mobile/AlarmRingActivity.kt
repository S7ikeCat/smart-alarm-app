package com.mobile

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * Экран звонка: только интерфейс. Мелодию и вибрацию ведёт AlarmService,
 * поэтому экран лишь отправляет сервису команды "выключить" и "отложить".
 */
class AlarmRingActivity : Activity() {

    // Сервис просит закрыть экран, если будильник выключили из уведомления.
    private val dismissReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        android.util.Log.d("AlarmDebug", "AlarmRingActivity.onCreate начался")

        // Показываем экран ПОВЕРХ блокировки, но блокировку не снимаем:
        // выключить будильник должно быть можно без ввода PIN.
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        ContextCompat.registerReceiver(
            this,
            dismissReceiver,
            IntentFilter(AlarmService.ACTION_DISMISSED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )

        val label = intent.getStringExtra("label") ?: "Будильник"

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#1A1614"))
        }

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
            setOnClickListener { sendCommand(AlarmService.ACTION_STOP) }
        }

        val snoozeButton = Button(this).apply {
            text = "Отложить"
            setOnClickListener { sendCommand(AlarmService.ACTION_SNOOZE) }
        }

        layout.addView(timeText)
        layout.addView(labelText)
        layout.addView(stopButton)
        layout.addView(snoozeButton)
        setContentView(layout)
    }

    private fun sendCommand(action: String) {
        startService(Intent(this, AlarmService::class.java).setAction(action))
        finish()
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(dismissReceiver)
        } catch (e: Exception) {
            // уже отписан
        }
        super.onDestroy()
    }
}