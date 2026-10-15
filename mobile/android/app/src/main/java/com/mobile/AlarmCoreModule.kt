package com.mobile

import android.app.Activity
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID
import uniffi.alarm_core.*

class AlarmCoreModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName() = "AlarmCore"

    // Путь к файлу БД внутри "песочницы" приложения — папка, которую
    // Android гарантированно выделяет каждому приложению для собственных данных.
    private fun dbPath(): String {
        val dir = reactApplicationContext.filesDir
        return File(dir, "alarm_core.db").absolutePath
    }

    // --- JSON (из JS) -> типизированный WorkSchedule для Rust -----------------

    private fun workScheduleFromJson(json: String): WorkSchedule {
        val obj = JSONObject(json)

        val patternArray = obj.getJSONArray("pattern")
        val dayTypes = mutableListOf<DayType>()
        for (i in 0 until patternArray.length()) {
            dayTypes.add(if (patternArray.getBoolean(i)) DayType.WORK else DayType.REST)
        }

        val alarmsArray = obj.getJSONArray("alarms")
        val alarms = mutableListOf<AlarmRule>()
        for (i in 0 until alarmsArray.length()) {
            val a = alarmsArray.getJSONObject(i)
            alarms.add(
                AlarmRule(
                    id = a.optString("id", UUID.randomUUID().toString()),
                    offsetMinutes = a.getInt("offsetMinutes"),
                    ringtoneId = a.optString("ringtoneId", "default"),
                    vibration = a.optBoolean("vibration", true),
                )
            )
        }

        val presetId = obj.optString("sourcePresetId", "")
        val source: ScheduleSource =
            if (presetId.isNotEmpty()) ScheduleSource.Preset(presetId) else ScheduleSource.Custom

        return WorkSchedule(
            id = obj.optString("id", UUID.randomUUID().toString()),
            name = obj.getString("name"),
            color = obj.getString("color"),
            pattern = SchedulePattern.Custom(dayTypes),
            source = source,
            startDate = obj.getString("startDate"),           // формат "YYYY-MM-DD"
            shiftStartTime = obj.getString("shiftStartTime"), // формат "HH:MM:SS"
            alarms = alarms,
            isActive = obj.optBoolean("isActive", true),
            isPaused = obj.optBoolean("isPaused", false),
        )
    }

    // --- список WorkSchedule (из Rust) -> JSON для JS --------------------------

    private fun workSchedulesToJson(schedules: List<WorkSchedule>): String {
        val array = JSONArray()
        for (schedule in schedules) {
            val obj = JSONObject()
            obj.put("id", schedule.id)
            obj.put("name", schedule.name)
            obj.put("color", schedule.color)

            val pattern = schedule.pattern
            val patternArray = JSONArray()
            if (pattern is SchedulePattern.Custom) {
                for (day in pattern.v1) {
                    patternArray.put(day == DayType.WORK || day == DayType.NIGHT_SHIFT)
                }
            }
            obj.put("pattern", patternArray)

            val source = schedule.source
            if (source is ScheduleSource.Preset) {
                obj.put("sourcePresetId", source.v1)
            } else {
                obj.put("sourcePresetId", JSONObject.NULL)
            }

            obj.put("startDate", schedule.startDate)
            obj.put("shiftStartTime", schedule.shiftStartTime)

            val alarmsArray = JSONArray()
            for (alarm in schedule.alarms) {
                val a = JSONObject()
                a.put("id", alarm.id)
                a.put("offsetMinutes", alarm.offsetMinutes)
                a.put("ringtoneId", alarm.ringtoneId)
                a.put("vibration", alarm.vibration)
                alarmsArray.put(a)
            }
            obj.put("alarms", alarmsArray)

            obj.put("isActive", schedule.isActive)
            obj.put("isPaused", schedule.isPaused)

            array.put(obj)
        }
        return array.toString()
    }

    // --- методы, доступные из JS -------------------------------------------------

    @ReactMethod
    fun saveWorkScheduleJson(scheduleJson: String, promise: Promise) {
    android.util.Log.d("AlarmCoreDebug", "Входящий JSON: $scheduleJson")
    try {
        val schedule = workScheduleFromJson(scheduleJson)
        saveWorkScheduleFfi(dbPath(), schedule)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("SAVE_ERROR", e.message, e)
    }
}

    @ReactMethod
    fun loadWorkSchedulesJson(promise: Promise) {
        try {
            val schedules = loadWorkSchedulesFfi(dbPath())
            promise.resolve(workSchedulesToJson(schedules))
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun deleteWorkSchedule(scheduleId: String, promise: Promise) {
        try {
            deleteWorkScheduleFfi(dbPath(), scheduleId)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("DELETE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setActiveSchedule(scheduleId: String, promise: Promise) {
        try {
            setActiveScheduleFfi(dbPath(), scheduleId)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SET_ACTIVE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun generateUpcomingAlarmsJson(horizonMonths: Double, promise: Promise) {
        try {
            val instances = generateUpcomingAlarmsFfi(dbPath(), horizonMonths.toUInt())
            val array = JSONArray()
            for (instance in instances) {
                val obj = JSONObject()
                obj.put("id", instance.id)
                obj.put("scheduleId", instance.scheduleId)
                obj.put("date", instance.date)
                obj.put("timeLocal", instance.timeLocal)
                obj.put("status", instance.status.name)
                obj.put("origin", instance.origin.name)
                array.put(obj)
            }
            promise.resolve(array.toString())
        } catch (e: Exception) {
            promise.reject("GENERATE_ERROR", e.message, e)
        }
    }
    
    @ReactMethod
fun saveDayOverridesJson(scheduleId: String, overridesJson: String, promise: Promise) {
    try {
        val array = JSONArray(overridesJson)
        val overrides = mutableListOf<DayOverride>()
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            overrides.add(
                DayOverride(
                    date = obj.getString("date"),
                    isWork = obj.getBoolean("isWork"),
                )
            )
        }
        saveDayOverridesFfi(dbPath(), scheduleId, overrides)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("SAVE_OVERRIDES_ERROR", e.message, e)
    }
}

@ReactMethod
fun loadDayOverridesJson(scheduleId: String, promise: Promise) {
    try {
        val overrides = loadDayOverridesFfi(dbPath(), scheduleId)
        val array = JSONArray()
        for (o in overrides) {
            val obj = JSONObject()
            obj.put("date", o.date)
            obj.put("isWork", o.isWork)
            array.put(obj)
        }
        promise.resolve(array.toString())
    } catch (e: Exception) {
        promise.reject("LOAD_OVERRIDES_ERROR", e.message, e)
    }
}

@ReactMethod
fun saveCustomEventJson(eventJson: String, promise: Promise) {
    try {
        val obj = JSONObject(eventJson)
        val event = CustomEvent(
            id = obj.getString("id"),
            date = obj.getString("date"),
            timeLocal = obj.getString("timeLocal"),
            color = obj.getString("color"),
            label = obj.getString("label"),
            description = obj.optString("description", ""),
            reminderEnabled = obj.optBoolean("reminderEnabled", true),
            // Старый интерфейс полей не присылает: тогда событие, как раньше, звонит будильником.
            urgent = obj.optBoolean("urgent", true),
            flagged = obj.optBoolean("flagged", false),
            completed = obj.optBoolean("completed", false),
            repeat = try {
                ReminderRepeat.valueOf(obj.optString("repeat", "ONCE"))
            } catch (e: IllegalArgumentException) {
                ReminderRepeat.ONCE
            },
            listId = if (obj.has("listId") && !obj.isNull("listId")) obj.getString("listId") else null,
        )
        saveCustomEventFfi(dbPath(), event)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("SAVE_EVENT_ERROR", e.message, e)
    }
}

@ReactMethod
fun loadCustomEventsJson(promise: Promise) {
    try {
        val events = loadCustomEventsFfi(dbPath())
        val array = JSONArray()
        for (ev in events) {
            val obj = JSONObject()
            obj.put("id", ev.id)
            obj.put("date", ev.date)
            obj.put("timeLocal", ev.timeLocal)
            obj.put("color", ev.color)
            obj.put("label", ev.label)
            obj.put("description", ev.description)
            obj.put("reminderEnabled", ev.reminderEnabled)
            obj.put("urgent", ev.urgent)
            obj.put("flagged", ev.flagged)
            obj.put("completed", ev.completed)
            obj.put("repeat", ev.repeat.name)
            obj.put("listId", ev.listId ?: JSONObject.NULL)
            array.put(obj)
        }
        promise.resolve(array.toString())
    } catch (e: Exception) {
        promise.reject("LOAD_EVENTS_ERROR", e.message, e)
    }
}

/** Отметить напоминание выполненным (повторяющееся уезжает на следующую дату). */
@ReactMethod
fun completeReminder(eventId: String, doneDate: String, promise: Promise) {
    try {
        completeReminderFfi(dbPath(), eventId, doneDate)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("COMPLETE_REMINDER_ERROR", e.message, e)
    }
}

@ReactMethod
fun saveReminderListJson(listJson: String, promise: Promise) {
    try {
        val obj = JSONObject(listJson)
        saveReminderListFfi(
            dbPath(),
            ReminderList(
                id = obj.getString("id"),
                name = obj.getString("name"),
                color = obj.getString("color"),
            ),
        )
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("SAVE_REMINDER_LIST_ERROR", e.message, e)
    }
}

@ReactMethod
fun loadReminderListsJson(promise: Promise) {
    try {
        val array = JSONArray()
        for (list in loadReminderListsFfi(dbPath())) {
            val obj = JSONObject()
            obj.put("id", list.id)
            obj.put("name", list.name)
            obj.put("color", list.color)
            array.put(obj)
        }
        promise.resolve(array.toString())
    } catch (e: Exception) {
        promise.reject("LOAD_REMINDER_LISTS_ERROR", e.message, e)
    }
}

@ReactMethod
fun deleteReminderList(listId: String, promise: Promise) {
    try {
        deleteReminderListFfi(dbPath(), listId)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("DELETE_REMINDER_LIST_ERROR", e.message, e)
    }
}

@ReactMethod
fun deleteCustomEvent(eventId: String, promise: Promise) {
    try {
        deleteCustomEventFfi(dbPath(), eventId)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("DELETE_EVENT_ERROR", e.message, e)
    }
}

@ReactMethod
fun saveSchedulePauseJson(pauseJson: String, promise: Promise) {
    try {
        val obj = JSONObject(pauseJson)
        val pause = SchedulePause(
            id = obj.getString("id"),
            scheduleId = obj.getString("scheduleId"),
            startDate = obj.getString("startDate"),
            endDate = obj.getString("endDate"),
            label = obj.getString("label"),
        )
        saveSchedulePauseFfi(dbPath(), pause)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("SAVE_PAUSE_ERROR", e.message, e)
    }
}

@ReactMethod
fun loadSchedulePausesJson(scheduleId: String, promise: Promise) {
    try {
        val pauses = loadSchedulePausesFfi(dbPath(), scheduleId)
        val array = JSONArray()
        for (p in pauses) {
            val obj = JSONObject()
            obj.put("id", p.id)
            obj.put("scheduleId", p.scheduleId)
            obj.put("startDate", p.startDate)
            obj.put("endDate", p.endDate)
            obj.put("label", p.label)
            array.put(obj)
        }
        promise.resolve(array.toString())
    } catch (e: Exception) {
        promise.reject("LOAD_PAUSES_ERROR", e.message, e)
    }
}

@ReactMethod
fun deleteSchedulePause(pauseId: String, promise: Promise) {
    try {
        deleteSchedulePauseFfi(dbPath(), pauseId)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("DELETE_PAUSE_ERROR", e.message, e)
    }
}

// --- дополнительные будильники ---------------------------------------------

@ReactMethod
fun saveExtraAlarmJson(alarmJson: String, promise: Promise) {
    try {
        val obj = JSONObject(alarmJson)
        val dateValue = if (obj.isNull("date")) null else obj.getString("date")
        val alarm = ExtraAlarm(
            id = obj.getString("id"),
            label = obj.optString("label", ""),
            timeLocal = obj.getString("timeLocal"),
            kind = ExtraAlarmKind.valueOf(obj.getString("kind")),
            date = dateValue,
            enabled = obj.optBoolean("enabled", true),
            sourceTz = if (obj.isNull("sourceTz")) null else obj.optString("sourceTz").ifBlank { null },
            leadMinutes = obj.optInt("leadMinutes", 0).coerceAtLeast(0).toUInt(),
        )
        saveExtraAlarmFfi(dbPath(), alarm)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("SAVE_EXTRA_ALARM_ERROR", e.message, e)
    }
}

@ReactMethod
fun loadExtraAlarmsJson(promise: Promise) {
    try {
        val array = JSONArray()
        for (a in loadExtraAlarmsFfi(dbPath())) {
            val obj = JSONObject()
            obj.put("id", a.id)
            obj.put("label", a.label)
            obj.put("timeLocal", a.timeLocal)
            obj.put("kind", a.kind.name)
            obj.put("date", a.date ?: JSONObject.NULL)
            obj.put("enabled", a.enabled)
            obj.put("sourceTz", a.sourceTz ?: JSONObject.NULL)
            obj.put("leadMinutes", a.leadMinutes.toInt())
            array.put(obj)
        }
        promise.resolve(array.toString())
    } catch (e: Exception) {
        promise.reject("LOAD_EXTRA_ALARMS_ERROR", e.message, e)
    }
}

@ReactMethod
fun deleteExtraAlarm(alarmId: String, promise: Promise) {
    try {
        deleteExtraAlarmFfi(dbPath(), alarmId)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("DELETE_EXTRA_ALARM_ERROR", e.message, e)
    }
}

@ReactMethod
fun generateExtraAlarmsJson(horizonMonths: Double, promise: Promise) {
    try {
        val array = JSONArray()
        for (i in generateExtraAlarmsFfi(dbPath(), horizonMonths.toUInt(), java.util.TimeZone.getDefault().id)) {
            val obj = JSONObject()
            obj.put("alarmId", i.alarmId)
            obj.put("date", i.date)
            obj.put("timeLocal", i.timeLocal)
            obj.put("label", i.label)
            array.put(obj)
        }
        promise.resolve(array.toString())
    } catch (e: Exception) {
        promise.reject("GENERATE_EXTRA_ALARMS_ERROR", e.message, e)
    }
}

// --- часовые пояса --------------------------------------------------------------

/** IANA-имя часового пояса телефона, например "Europe/Moscow". */
@ReactMethod
fun getDeviceTimeZone(promise: Promise) {
    promise.resolve(java.util.TimeZone.getDefault().id)
}

/**
 * Переводит время события из часового пояса sourceTz в местное (за вычетом
 * «разбудить за N минут»). Возвращает JSON {"date": "...", "timeLocal": "..."}.
 */
@ReactMethod
fun convertEventTimeJson(date: String, time: String, sourceTz: String, leadMinutes: Double, promise: Promise) {
    try {
        val local = convertEventTimeFfi(
            date,
            time,
            sourceTz,
            leadMinutes.toInt().coerceAtLeast(0).toUInt(),
            java.util.TimeZone.getDefault().id,
        )
        val obj = JSONObject()
        obj.put("date", local.date)
        obj.put("timeLocal", local.timeLocal)
        promise.resolve(obj.toString())
    } catch (e: Exception) {
        promise.reject("CONVERT_EVENT_TIME_ERROR", e.message, e)
    }
}

// --- время будильника графика на конкретную дату -------------------------------

@ReactMethod
fun saveAlarmTimeOverrideJson(itemJson: String, promise: Promise) {
    try {
        val obj = JSONObject(itemJson)
        saveAlarmTimeOverrideFfi(
            dbPath(),
            AlarmTimeOverride(
                scheduleId = obj.getString("scheduleId"),
                date = obj.getString("date"),
                ruleId = obj.getString("ruleId"),
                timeLocal = obj.getString("timeLocal"),
            ),
        )
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("SAVE_TIME_OVERRIDE_ERROR", e.message, e)
    }
}

@ReactMethod
fun loadAlarmTimeOverridesJson(scheduleId: String, promise: Promise) {
    try {
        val array = JSONArray()
        for (t in loadAlarmTimeOverridesFfi(dbPath(), scheduleId)) {
            val obj = JSONObject()
            obj.put("scheduleId", t.scheduleId)
            obj.put("date", t.date)
            obj.put("ruleId", t.ruleId)
            obj.put("timeLocal", t.timeLocal)
            array.put(obj)
        }
        promise.resolve(array.toString())
    } catch (e: Exception) {
        promise.reject("LOAD_TIME_OVERRIDES_ERROR", e.message, e)
    }
}

@ReactMethod
fun deleteAlarmTimeOverride(scheduleId: String, date: String, ruleId: String, promise: Promise) {
    try {
        deleteAlarmTimeOverrideFfi(dbPath(), scheduleId, date, ruleId)
        promise.resolve(null)
    } catch (e: Exception) {
        promise.reject("DELETE_TIME_OVERRIDE_ERROR", e.message, e)
    }
}

    // --- Простые настройки приложения (ключ -> строка) --------------------------

    private fun prefs() = AlarmSettings.prefs(reactApplicationContext)

    @ReactMethod
    fun getSetting(key: String, promise: Promise) {
        try {
            promise.resolve(prefs().getString(key, null))
        } catch (e: Exception) {
            promise.reject("GET_SETTING_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setSetting(key: String, value: String, promise: Promise) {
        try {
            prefs().edit().putString(key, value).apply()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("SET_SETTING_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun removeSetting(key: String, promise: Promise) {
        try {
            prefs().edit().remove(key).apply()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("REMOVE_SETTING_ERROR", e.message, e)
        }
    }

    // --- Выбор и прослушивание мелодии -------------------------------------------

    private val REQUEST_PICK_RINGTONE = 7101
    private val REQUEST_PICK_FILE = 7102
    private var pickPromise: Promise? = null
    private var previewPlayer: MediaPlayer? = null
    private val previewHandler = Handler(Looper.getMainLooper())
    private val previewStopper = Runnable { stopPreviewInternal() }

    /** Системное окно выбора мелодии (со встроенным прослушиванием). */
    @ReactMethod
    fun pickSystemRingtone(currentUri: String, promise: Promise) {
        val activity: Activity? = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Нет активного экрана")
            return
        }
        try {
            pickPromise?.resolve(null)
            pickPromise = promise
            val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
                putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
                putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, false)
                putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
                putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Мелодия будильника")
                if (currentUri.isNotBlank()) {
                    putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Uri.parse(currentUri))
                }
            }
            activity.startActivityForResult(intent, REQUEST_PICK_RINGTONE)
        } catch (e: Exception) {
            pickPromise = null
            promise.reject("PICK_RINGTONE_ERROR", e.message, e)
        }
    }

    /** Выбор своего аудиофайла через системный файловый диалог (SAF). */
    @ReactMethod
    fun pickAudioFile(promise: Promise) {
        val activity: Activity? = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Нет активного экрана")
            return
        }
        try {
            pickPromise?.resolve(null)
            pickPromise = promise
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "audio/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            }
            activity.startActivityForResult(intent, REQUEST_PICK_FILE)
        } catch (e: Exception) {
            pickPromise = null
            promise.reject("PICK_FILE_ERROR", e.message, e)
        }
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST_PICK_RINGTONE && requestCode != REQUEST_PICK_FILE) return
        val promise = pickPromise ?: return
        pickPromise = null
        try {
            if (resultCode != Activity.RESULT_OK || data == null) {
                promise.resolve(null) // человек закрыл окно, ничего не выбрав
                return
            }
            val uri: Uri? = if (requestCode == REQUEST_PICK_RINGTONE) {
                data.getParcelableExtra<Uri>(RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
            } else {
                data.data
            }
            if (uri == null) {
                promise.resolve(null)
                return
            }
            if (requestCode == REQUEST_PICK_FILE) {
                // Чтобы файл оставался доступен после перезагрузки телефона.
                try {
                    reactApplicationContext.contentResolver.takePersistableUriPermission(
                        uri, Intent.FLAG_GRANT_READ_URI_PERMISSION,
                    )
                } catch (e: Exception) {
                    AlarmJournal.log(reactApplicationContext, "не удалось закрепить доступ к файлу: ${e.message}")
                }
            }
            val obj = JSONObject()
            obj.put("uri", uri.toString())
            obj.put("title", titleOf(uri))
            promise.resolve(obj.toString())
        } catch (e: Exception) {
            promise.reject("PICK_RESULT_ERROR", e.message, e)
        }
    }

    override fun onNewIntent(intent: Intent) {}

    private fun titleOf(uri: Uri): String {
        try {
            if (uri.scheme == "content") {
                val cursor = reactApplicationContext.contentResolver.query(
                    uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null,
                )
                cursor?.use {
                    if (it.moveToFirst()) {
                        val name = it.getString(0)
                        if (!name.isNullOrBlank()) return name
                    }
                }
            }
        } catch (e: Exception) {
            // пойдём другим путём
        }
        try {
            val ringtone = RingtoneManager.getRingtone(reactApplicationContext, uri)
            val title = ringtone?.getTitle(reactApplicationContext)
            if (!title.isNullOrBlank()) return title
        } catch (e: Exception) {
            // оставим запасное имя
        }
        return uri.lastPathSegment ?: "Мелодия"
    }

    /** Проигрывает мелодию (пустая строка — стандартная) не дольше 8 секунд. */
    @ReactMethod
    fun previewRingtone(uriString: String, promise: Promise) {
        try {
            stopPreviewInternal()
            val uri = if (uriString.isBlank()) {
                AlarmSettings.defaultAlarmUri(reactApplicationContext)
            } else {
                Uri.parse(uriString)
            }
            val player = MediaPlayer()
            try {
                player.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
                player.setDataSource(reactApplicationContext, uri)
                player.isLooping = true
                player.prepare()
                player.start()
            } catch (e: Exception) {
                player.release()
                throw e
            }
            previewPlayer = player
            previewHandler.postDelayed(previewStopper, 8000)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PREVIEW_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopPreview(promise: Promise) {
        stopPreviewInternal()
        promise.resolve(null)
    }

    private fun stopPreviewInternal() {
        previewHandler.removeCallbacks(previewStopper)
        try {
            previewPlayer?.stop()
        } catch (e: Exception) {
            // уже остановлен
        }
        previewPlayer?.release()
        previewPlayer = null
    }
}
