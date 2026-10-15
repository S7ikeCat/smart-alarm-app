package com.mobile

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextClock
import android.widget.TextView
import kotlin.math.abs

/**
 * Весь вид экрана звонка в одном View: время, название, «Пауза», кружок.
 * Его показывают и обычный экран (AlarmRingActivity), и «плашка поверх
 * приложений» (окно из AlarmService), поэтому выглядит всё одинаково.
 *
 * shakeMode: 0 — встряска выключена, 1 — встряска выключает будильник,
 * 2 — встряска откладывает его.
 */
class RingScreenView(
    context: Context,
    label: String,
    private val snoozesLeft: Int, // -1 без лимита, 0 нельзя, N осталось
    private val snoozeMinutes: Int,
    private val shakeMode: Int,
    withDim: Boolean,
    private val onStop: () -> Unit,
    private val onSnooze: () -> Unit,
    private val isReminder: Boolean = false,
) : FrameLayout(context) {

    private val density = resources.displayMetrics.density
    private var acted = false

    private var sensorManager: SensorManager? = null
    private var shakeListener: SensorEventListener? = null

    private fun dp(value: Int): Int = (value * density).toInt()

    /** Любое действие выполняется один раз, даже если кружок и встряска сработали вместе. */
    private fun act(block: () -> Unit) {
        if (acted) return
        acted = true
        block()
    }

    /** Кружок: его тянут, чтобы выключить. От него расходятся тихие круги — для красоты. */
    private inner class Knob(context: Context) : View(context) {
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
            for (i in 0 until 3) {
                val p = (phase + i / 3f) % 1f
                val r = coreRadius + (maxRadius - coreRadius) * p
                val fade = 1f - p
                wave.alpha = (fade * fade * 140).toInt()
                canvas.drawCircle(cx, cy, r, wave)
            }
            canvas.drawCircle(cx, cy, coreRadius, ring)
            canvas.drawCircle(cx, cy, density * 1.5f, dot)
        }
    }

    private fun smallDot(): View = View(context).apply {
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#99FFFFFF"))
        }
    }

    init {
        clipChildren = false
        if (withDim) setBackgroundColor(Color.argb(160, 0, 0, 0))

        // Отступы под строку состояния и панель навигации.
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

        val white = Color.parseColor("#F5F5F5")

        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            clipChildren = false
        }

        val timeText = TextClock(context).apply {
            format24Hour = "HH:mm"
            format12Hour = "h:mm"
            textSize = 92f
            typeface = Typeface.create("sans-serif-thin", Typeface.NORMAL)
            setTextColor(white)
            gravity = Gravity.CENTER
            includeFontPadding = false
        }

        val dateText = TextClock(context).apply {
            format24Hour = "EEEE, d MMMM"
            format12Hour = "EEEE, d MMMM"
            textSize = 20f
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            setTextColor(white)
            gravity = Gravity.CENTER
        }

        val labelText = TextView(context).apply {
            text = label
            textSize = 34f
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            setTextColor(white)
            gravity = Gravity.CENTER
            setPadding(dp(24), 0, dp(24), 0)
        }

        val snoozeButton = Button(context).apply {
            text = when {
                isReminder && snoozesLeft < 0 -> "Позже ($snoozeMinutes мин)"
                isReminder -> "Позже ($snoozeMinutes мин) · осталось $snoozesLeft"
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
            setOnClickListener { act(onSnooze) }
        }

        val hint = TextView(context).apply {
            textSize = 18f
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            setTextColor(white)
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(12), dp(24), dp(if (shakeMode == 2) 8 else 28))
        }

        // Метка «Напоминание»: экран тот же, но сразу видно, что это не будильник.
        val badge = TextView(context).apply {
            text = "🔔  НАПОМИНАНИЕ"
            textSize = 14f
            letterSpacing = 0.12f
            setTextColor(Color.parseColor("#FFB4A8"))
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(7), dp(18), dp(7))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(20).toFloat()
                setColor(Color.parseColor("#33D64541"))
                setStroke(dp(1), Color.parseColor("#CCFF8A80"))
            }
        }

        fun space(weight: Float) = View(context).apply {
            layoutParams = LinearLayout.LayoutParams(0, 0, weight)
        }

        root.addView(space(0.35f))
        root.addView(timeText)
        root.addView(dateText)
        root.addView(space(1f))
        root.addView(labelText)
        if (isReminder) {
            root.addView(
                badge,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { topMargin = dp(14) },
            )
        }
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

        if (shakeMode == 1) {
            hint.text = if (isReminder) "Встряхни телефон, чтобы закрыть" else "Встряхни телефон, чтобы выключить"
            root.addView(hint)
        } else {
            hint.text = if (isReminder) "Проведите, чтобы закрыть напоминание" else "Проведите, чтобы выключить будильник"
            val track = FrameLayout(context).apply { clipChildren = false }
            val knobSize = dp(170)
            val dotOffset = dp(74)
            val dotSize = dp(5)
            val sideMargin = resources.displayMetrics.widthPixels / 2 - dotOffset - dotSize / 2
            val knob = Knob(context)
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

            if (shakeMode == 2 && snoozesLeft != 0) {
                root.addView(
                    TextView(context).apply {
                        text = "Встряхни телефон — отложить на $snoozeMinutes мин"
                        textSize = 14f
                        typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
                        setTextColor(Color.parseColor("#99F5F5F5"))
                        gravity = Gravity.CENTER
                        setPadding(dp(24), 0, dp(24), dp(24))
                    },
                )
            }

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
                            act(onStop)
                        } else {
                            v.animate().translationX(0f).setDuration(150).start()
                        }
                        true
                    }
                    else -> false
                }
            }
        }

        addView(root, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        requestApplyInsets()
        if (shakeMode != 0) startShakeDetection()
    }

    override fun onDetachedFromWindow() {
        shakeListener?.let { sensorManager?.unregisterListener(it) }
        shakeListener = null
        super.onDetachedFromWindow()
    }

    /**
     * Встряска = три рывка за 2 секунды, каждый заметно сильнее покоя (>1.4 g).
     * Первые 1,5 секунды после показа не считаем — чтобы не ловить момент,
     * когда телефон берут в руки.
     */
    private fun startShakeDetection() {
        val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensor = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        val startedAt = SystemClock.elapsedRealtime()
        var firstSpike = 0L
        var lastSpike = 0L
        var spikes = 0
        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (acted) return
                val g = Math.sqrt(
                    (event.values[0] * event.values[0] +
                        event.values[1] * event.values[1] +
                        event.values[2] * event.values[2]).toDouble(),
                ) / SensorManager.GRAVITY_EARTH
                if (Math.abs(g - 1.0) <= 1.4) return
                val now = SystemClock.elapsedRealtime()
                if (now - startedAt < 1500) return
                if (now - lastSpike < 150) return
                lastSpike = now
                if (spikes == 0 || now - firstSpike > 2000) {
                    spikes = 1
                    firstSpike = now
                } else {
                    spikes++
                }
                if (spikes >= 3) {
                    if (shakeMode == 1) {
                        act(onStop)
                    } else if (shakeMode == 2 && snoozesLeft != 0) {
                        act(onSnooze)
                    }
                }
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
        }
        sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_GAME)
        sensorManager = sm
        shakeListener = listener
    }
}
