package com.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Android стирает все будильники приложения при перезагрузке телефона и при
 * обновлении самого приложения. Этот приёмник ставит их заново без участия
 * JS, прямо из базы.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) {
            return
        }
        android.util.Log.d("AlarmDebug", "BootReceiver: $action")

        val pending = goAsync()
        Thread {
            try {
                AlarmSyncer.sync(context.applicationContext)
            } catch (e: Exception) {
                android.util.Log.d("AlarmDebug", "BootReceiver: синхронизация УПАЛА: ${e.message}")
            } finally {
                pending.finish()
            }
        }.start()
    }
}