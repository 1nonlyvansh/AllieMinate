package com.alliminate.android.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Wired to the "Stop" action on the incoming-transfer notification. */
class StopTransferReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        IncomingTransferControl.cancelled.set(true)
        TransferNotifications.clearIncomingProgress(context)
    }
}
