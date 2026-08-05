package com.alliminate.android.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.alliminate.android.MainActivity
import com.alliminate.android.R

const val EXTRA_OPEN_ROUTE = "open_route"

/** One-tap home-screen shortcut straight into ShareScreen — for when you just want to send a file
 * without going through the drawer first. */
class QuickShareWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        appWidgetIds.forEach { id ->
            val views = RemoteViews(context.packageName, R.layout.widget_quick_share)
            val openIntent = Intent(context, MainActivity::class.java).apply {
                putExtra(EXTRA_OPEN_ROUTE, "share")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = android.app.PendingIntent.getActivity(
                context, 1, openIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.widget_share_root, pendingIntent)
            appWidgetManager.updateAppWidget(id, views)
        }
    }
}
