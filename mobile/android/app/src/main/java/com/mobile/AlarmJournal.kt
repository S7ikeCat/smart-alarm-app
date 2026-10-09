package com.mobile

import android.content.Context
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Журнал событий будильника: небольшой текстовый файл, в который пишут
 * приёмники, синхронизация и сервис звонка. Нужен, потому что logcat на
 * некоторых прошивках (Honor) теряет строки, а файл переживает перезагрузку.
 */
object AlarmJournal {
    private const val FILE_NAME = "alarm_journal.txt"
    private const val MAX_BYTES = 64 * 1024L
    private const val KEEP_CHARS = 32 * 1024

    private val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)

    private fun file(context: Context) = File(context.filesDir, FILE_NAME)

    @Synchronized
    fun log(context: Context, message: String) {
        try {
            val f = file(context)
            if (f.exists() && f.length() > MAX_BYTES) {
                val tail = f.readText().takeLast(KEEP_CHARS)
                f.writeText(tail.substringAfter('\n', tail))
            }
            f.appendText("${formatter.format(Date())}  $message\n")
        } catch (e: Exception) {
            android.util.Log.d("AlarmDebug", "журнал не записан: ${e.message}")
        }
    }

    @Synchronized
    fun read(context: Context, maxLines: Int = 80): String {
        val f = file(context)
        if (!f.exists()) return "(журнал пуст)"
        return f.readLines().takeLast(maxLines).joinToString("\n")
    }

    @Synchronized
    fun clear(context: Context) {
        file(context).delete()
    }
}