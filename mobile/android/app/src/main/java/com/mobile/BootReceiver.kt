package com.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Android стирает все будильники приложения при перезагрузке телефона и при
 * обновлении самого приложения. Этот приёмник ставит их заново без участия JS.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val reason = when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> "перезагрузка"
            Intent.ACTION_MY_PACKAGE_REPLACED -> "обновление приложения"
            else -> return
        }
        AlarmJournal.log(context, "получено событие: $reason")

        val pending = goAsync()
        Thread {
            try {
                AlarmSyncer.sync(context.applicationContext, reason)
            } catch (e: Exception) {
                AlarmJournal.log(context, "ОШИБКА синхронизации ($reason): ${e.message}")
            } finally {
                pending.finish()
            }
        }.start()
    }
}