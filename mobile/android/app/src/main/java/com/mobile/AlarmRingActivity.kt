package com.mobile

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextClock
import android.widget.TextView
import androidx.core.content.ContextCompat
import kotlin.math.abs

/**
 * Экран звонка: только интерфейс. Мелодию и вибрацию ведёт AlarmService,
 * поэтому экран лишь отправляет сервису команды "выключить" и "отложить".
 *
 * Вид — как у системного будильника на экране блокировки: время сверху,
 * название по центру, кнопка «Пауза», а внизу кружок, который тянут
 * влево или вправо, чтобы выключить. Фон — обои с сильным размытием.
 */
class AlarmRingActivity : Activity() {

    // Предпросмотр из «Инструментов»: звука нет, кнопки только закрывают экран.
    private var isPreview = false

    private var sensorManager: SensorManager? = null
    private var shakeListener: SensorEventListener? = null

    // Сервис просит закрыть экран, если будильник выключили из уведомления.
    private val dismissReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            finish()
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    /**
     * Кружок с точкой в центре: его тянут, чтобы выключить будильник.
     * От него постоянно расходятся тихие круги — просто для красоты.
     * Сам вид больше кружка (круги выходят за его границы), поэтому
     * реагирует на касание только область самого кружка.
     */
    private inner class Knob(context: Context) : View(context) {
        private val density = resources.displayMetrics.density
        private val coreRadius = 36 * density
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = density * 1.5f
            color = Color.WHITE
        }
        private val wave = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = density * 1.5f
            color = Color.WHITE
        }
        private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.WHITE
        }
        private var phase = 0f
        private var animator: android.animation.ValueAnimator? = null

        fun isOnCore(x: Float, y: Float): Boolean {
            val dx = x - width / 2f
            val dy = y - height / 2f
            return dx * dx + dy * dy <= (coreRadius * 1.3f) * (coreRadius * 1.3f)
        }

        override fun onAttachedToWindow() {
            super.onAttachedToWindow()
            animator = android.animation.ValueAnimator.ofFloat(0f, 1f).apply {
                duration = 2400
                repeatCount = android.animation.ValueAnimator.INFINITE
                interpolator = android.view.animation.LinearInterpolator()
                addUpdateListener {
                    phase = it.animatedValue as Float
                    invalidate()
                }
                start()
            }
        }

        override fun onDetachedFromWindow() {
            animator?.cancel()
            animator = null
            super.onDetachedFromWindow()
        }

        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f
            val cy = height / 2f
            val maxRadius = minOf(cx, cy) - density
            // три волны, сдвинутые по времени: расходятся и гаснут
            for (i in 0 until 3) {
                val p = (phase + i / 3f) % 1f
                val r = coreRadius + (maxRadius - coreRadius) * p
                val fade = (1f - p)
                wave.alpha = (fade * fade * 140).toInt()
                canvas.drawCircle(cx, cy, r, wave)
            }
            canvas.drawCircle(cx, cy, coreRadius, ring)
            canvas.drawCircle(cx, cy, density * 1.5f, dot)
        }
    }

    private fun smallDot(): View = View(this).apply {
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#99FFFFFF"))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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

        isPreview = intent.getBooleanExtra("preview", false)
        val label = intent.getStringExtra("label") ?: "Будильник"
        // -1 = без лимита, 0 = откладывать больше нельзя, N = осталось N раз
        val snoozesLeft = intent.getIntExtra("snoozesLeft", -1)
        val snoozeMinutes = intent.getIntExtra("snoozeMinutes", 5)

        val white = Color.parseColor("#F5F5F5")

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            clipChildren = false
            setOnApplyWindowInsetsListener { v, insets ->
                val top: Int
                val bottom: Int
                if (Build.VERSION.SDK_INT >= 30) {
                    val bars = insets.getInsets(WindowInsets.Type.systemBars())
                    top = bars.top
                    bottom = bars.bottom
                } else {
                    @Suppress("DEPRECATION")
                    top = insets.systemWindowInsetTop
                    @Suppress("DEPRECATION")
                    bottom = insets.systemWindowInsetBottom
                }
                v.setPadding(0, top, 0, bottom)
                insets
            }
        }

        val timeText = TextClock(this).apply {
            format24Hour = "HH:mm"
            format12Hour = "h:mm"
            textSize = 92f
            typeface = Typeface.create("sans-serif-thin", Typeface.NORMAL)
            setTextColor(white)
            gravity = Gravity.CENTER
            includeFontPadding = false
        }

        val dateText = TextClock(this).apply {
            format24Hour = "EEEE, d MMMM"
            format12Hour = "EEEE, d MMMM"
            textSize = 20f
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            setTextColor(white)
            gravity = Gravity.CENTER
        }

        val labelText = TextView(this).apply {
            text = label
            textSize = 34f
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            setTextColor(white)
            gravity = Gravity.CENTER
            setPadding(dp(24), 0, dp(24), 0)
        }

        val snoozeButton = Button(this).apply {
            text = when {
                snoozesLeft < 0 -> "Пауза ($snoozeMinutes мин)"
                else -> "Пауза ($snoozeMinutes мин) · осталось $snoozesLeft"
            }.uppercase()
            textSize = 16f
            setTextColor(white)
            stateListAnimator = null
            setPadding(dp(28), dp(10), dp(28), dp(10))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(26).toFloat()
                setColor(Color.parseColor("#33FFFFFF"))
                setStroke(dp(1), Color.parseColor("#99FFFFFF"))
            }
            setOnClickListener { sendCommand(AlarmService.ACTION_SNOOZE) }
        }

        val hint = TextView(this).apply {
            textSize = 18f
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            setTextColor(white)
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(12), dp(24), dp(28))
        }

        fun space(weight: Float) = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, 0, weight)
        }

        root.addView(space(0.35f))
        root.addView(timeText)
        root.addView(dateText)
        root.addView(space(1f))
        root.addView(labelText)
        if (snoozesLeft != 0) {
            root.addView(
                snoozeButton,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(20) },
            )
        }
        root.addView(space(1.1f))

        if (AlarmSettings.shakeRequired(this)) {
            hint.text = "Встряхни телефон, чтобы выключить"
            root.addView(hint)
            startShakeDetection { sendCommand(AlarmService.ACTION_STOP) }
        } else {
            hint.text = "Проведите, чтобы выключить будильник"
            val track = FrameLayout(this).apply { clipChildren = false }
            val knobSize = dp(170)
            // точки стоят близко к кружку: на расстоянии dp(60) от центра с каждой стороны
            val dotOffset = dp(74)
            val dotSize = dp(5)
            val sideMargin = resources.displayMetrics.widthPixels / 2 - dotOffset - dotSize / 2
            val knob = Knob(this)
            track.addView(
                smallDot(),
                FrameLayout.LayoutParams(dotSize, dotSize, Gravity.CENTER_VERTICAL or Gravity.START)
                    .apply { marginStart = sideMargin },
            )
            track.addView(
                smallDot(),
                FrameLayout.LayoutParams(dotSize, dotSize, Gravity.CENTER_VERTICAL or Gravity.END)
                    .apply { marginEnd = sideMargin },
            )
            track.addView(knob, FrameLayout.LayoutParams(knobSize, knobSize, Gravity.CENTER))
            root.addView(
                track,
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(120)),
            )
            root.addView(hint)

            var downX = 0f
            knob.setOnTouchListener { v, e ->
                val maxShift = (track.width - v.width) / 2f
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        if (!knob.isOnCore(e.x, e.y)) return@setOnTouchListener false
                        downX = e.rawX
                        v.parent.requestDisallowInterceptTouchEvent(true)
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        v.translationX = (e.rawX - downX).coerceIn(-maxShift, maxShift)
                        true
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        if (abs(v.translationX) >= minOf(dp(64).toFloat(), maxShift)) {
                            sendCommand(AlarmService.ACTION_STOP)
                        } else {
                            v.animate().translationX(0f).setDuration(150).start()
                        }
                        true
                    }
                    else -> false
                }
            }
        }
        setContentView(root)
    }

    /**
     * Фон: обои телефона с сильным размытием (Android 12+, если система не
     * отключила размытие). Иначе — те же обои, но затемнённые сильнее.
     */
    private fun applyBlurredBackground() {
        var blurOk = false
        if (Build.VERSION.SDK_INT >= 31) {
            val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
            blurOk = wm.isCrossWindowBlurEnabled
            if (blurOk) {
                // Совсем лёгкое размытие: фон чуть мягче, чтобы текст не сливался с приложением.
                window.setBackgroundBlurRadius(dp(14))
                window.addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
                window.attributes = window.attributes.apply { blurBehindRadius = dp(14) }
            }
        }
        window.setBackgroundDrawable(ColorDrawable(Color.argb(if (blurOk) 120 else 160, 0, 0, 0)))
    }

    /** Один заметный встряхивающий рывок (три рывка за 2 с, каждый больше ~1.4 g) — и можно выключать. Телефон трясти сильно не нужно. */
    private fun startShakeDetection(onShake: () -> Unit) {
        val sm = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensor = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        var done = false
        var firstSpike = 0L
        var spikes = 0
        var lastSpike = 0L
        val startedAt = android.os.SystemClock.elapsedRealtime()
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (done) return
                val g = Math.sqrt(
                    (event.values[0] * event.values[0] +
                        event.values[1] * event.values[1] +
                        event.values[2] * event.values[2]).toDouble(),
                ) / SensorManager.GRAVITY_EARTH
                // g≈1 в покое; рывок даёт отклонение вверх или вниз
                if (Math.abs(g - 1.0) > 1.4) {
                    val now = android.os.SystemClock.elapsedRealtime()
                    // Взять телефон в руки — один рывок. Встряска — три рывка за ~2 с.
                    if (now - startedAt < 1500) return // сразу после показа экрана не считаем
                    if (now - lastSpike < 150) return
                    lastSpike = now
                    if (spikes == 0 || now - firstSpike > 2000) {
                        spikes = 1
                        firstSpike = now
                    } else {
                        spikes++
                    }
                    if (spikes >= 3) {
                        done = true
                        onShake()
                    }
                }
            }
            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
        }
        sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)
        sensorManager = sm
        shakeListener = listener
    }

    private fun sendCommand(action: String) {
        if (!isPreview) startService(Intent(this, AlarmService::class.java).setAction(action))
        finish()
    }

    override fun onDestroy() {
        shakeListener?.let { sensorManager?.unregisterListener(it) }
        try {
            unregisterReceiver(dismissReceiver)
        } catch (e: Exception) {
            // уже отписан
        }
        super.onDestroy()
    }
}