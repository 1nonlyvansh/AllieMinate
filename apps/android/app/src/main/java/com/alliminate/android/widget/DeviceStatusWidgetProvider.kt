package com.alliminate.android.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.alliminate.android.MainActivity
import com.alliminate.android.R
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.Prefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private const val COLOR_ONLINE = 0xFF32D74B.toInt()
private const val COLOR_OFFLINE = 0xFFFF453A.toInt()
private const val COLOR_UNPAIRED = 0xFF61F5F5.toInt()

/** Home-screen glance: shows which Master Device this phone is paired with and whether it's reachable
 * right now, tap opens the app. Android floors widget auto-refresh at ~30 minutes, so this is a glance,
 * not a live dashboard — good enough for "is my Mac reachable" at a look.
 *
 * AppWidgetProvider is a BroadcastReceiver — its onUpdate() is only guaranteed to run until it RETURNS,
 * after which the OS is free to kill the process. The original version launched a network ping in a
 * detached CoroutineScope and returned immediately, so the system could (and on some devices reliably
 * did) tear the process down mid-ping, leaving the widget stuck on a broken RemoteViews update — that's
 * the "error occurred when loading widget" host apps show. goAsync() + pendingResult.finish() keeps the
 * receiver alive until the real work is done. */
class DeviceStatusWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                appWidgetIds.forEach { id -> updateWidget(context, appWidgetManager, id) }
            } finally {
                pendingResult.finish()
            }
        }
    }

    private suspend fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, widgetId: Int) {
        Prefs.init(context)

        val openIntent = Intent(context, MainActivity::class.java)
        val pendingIntent = android.app.PendingIntent.getActivity(
            context, 0, openIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
        )

        val masters = Prefs.pairedMasters.toList()

        val views = RemoteViews(context.packageName, R.layout.widget_device_status)
        views.setOnClickPendingIntent(R.id.widget_title, pendingIntent)

        if (masters.isEmpty()) {
            views.setTextViewText(R.id.widget_status_text, "Not paired — tap to open")
            views.setInt(R.id.widget_status_dot, "setBackgroundColor", COLOR_UNPAIRED)
            appWidgetManager.updateAppWidget(widgetId, views)
            return
        }

        if (masters.size == 1) {
            val master = masters[0]
            val online = runCatching { MasterApi.ping(master.host, master.token) }.getOrDefault(false)
            views.setTextViewText(R.id.widget_status_text, "${master.name} — ${if (online) "Online" else "Offline"}")
            views.setInt(R.id.widget_status_dot, "setBackgroundColor", if (online) COLOR_ONLINE else COLOR_OFFLINE)
            appWidgetManager.updateAppWidget(widgetId, views)
            return
        }

        val onlineCount = masters.count { runCatching { MasterApi.ping(it.host, it.token) }.getOrDefault(false) }
        views.setTextViewText(R.id.widget_status_text, "$onlineCount of ${masters.size} PCs online")
        views.setInt(R.id.widget_status_dot, "setBackgroundColor", if (onlineCount > 0) COLOR_ONLINE else COLOR_OFFLINE)
        appWidgetManager.updateAppWidget(widgetId, views)
    }
}
