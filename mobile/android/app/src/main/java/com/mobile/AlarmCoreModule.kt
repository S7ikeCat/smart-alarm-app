package com.mobile

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
    ReactContextBaseJavaModule(reactContext) {

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
}