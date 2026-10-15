package com.mobile

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.core.content.ContextCompat

/**
 * Экран звонка (когда телефон заблокирован или выключен экран, либо нет разрешения
 * «поверх других приложений»). Сам вид — RingScreenView, мелодию ведёт AlarmService.
 */
class AlarmRingActivity : Activity() {

    // Предпросмотр из «Инструментов»: звука нет, кнопки только закрывают экран.
    private var isPreview = false

    // Сервис просит закрыть экран, если будильник выключили не отсюда.
    private val dismissReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            finish()
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        isPreview = intent.getBooleanExtra("preview", false)

        // Плашка поверх приложений уже на экране — второй экран не нужен.
        if (AlarmService.overlayShowing && !isPreview) {
            finish()
            return
        }

        android.util.Log.d("AlarmDebug", "AlarmRingActivity.onCreate начался")
        AlarmJournal.log(this, "экран звонка показан")

        // Показываем экран ПОВЕРХ блокировки, но блокировку не снимаем:
        // выключить будильник должно быть можно без ввода PIN.
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS,
        )
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        applyBlurredBackground()

        ContextCompat.registerReceiver(
            this,
            dismissReceiver,
            IntentFilter(AlarmService.ACTION_DISMISSED),
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )

        setContentView(
            RingScreenView(
                this,
                intent.getStringExtra("label") ?: "Будильник",
                // -1 = без лимита, 0 = откладывать больше нельзя, N = осталось N раз
                intent.getIntExtra("snoozesLeft", -1),
                intent.getIntExtra("snoozeMinutes", 5),
                AlarmSettings.shakeMode(this),
                false,
                { sendCommand(AlarmService.ACTION_STOP) },
                { sendCommand(AlarmService.ACTION_SNOOZE) },
                (intent.getStringExtra("alarmId") ?: "").startsWith("event:"),
            ),
        )
    }

    /** Обои телефона, чуть размытые (Android 12+, если размытие не отключено), и затемнение. */
    private fun applyBlurredBackground() {
        var blurOk = false
        if (Build.VERSION.SDK_INT >= 31) {
            val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            blurOk = wm.isCrossWindowBlurEnabled
            if (blurOk) {
                window.setBackgroundBlurRadius(dp(14))
                window.addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
                window.attributes = window.attributes.apply { blurBehindRadius = dp(14) }
            }
        }
        window.setBackgroundDrawable(ColorDrawable(Color.argb(if (blurOk) 120 else 160, 0, 0, 0)))
    }

    private fun sendCommand(action: String) {
        if (!isPreview) startService(Intent(this, AlarmService::class.java).setAction(action))
        finish()
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(dismissReceiver)
        } catch (e: Exception) {
            // не был подписан или уже отписан
        }
        super.onDestroy()
    }
}
