package com.alliminate.android.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.alliminate.android.service.NearbyShareRegistry

/** Wired to the Accept/Decline actions on a Nearby Share request notification. */
class NearbyRequestReceiver : BroadcastReceiver() {
    companion object {
        const val EXTRA_REQUEST_ID = "requestId"
        const val EXTRA_ACCEPT = "accept"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: return
        val accept = intent.getBooleanExtra(EXTRA_ACCEPT, false)
        NearbyShareRegistry.respond(requestId, accept)
        TransferNotifications.clearNearbyRequest(context, requestId)
    }
}
