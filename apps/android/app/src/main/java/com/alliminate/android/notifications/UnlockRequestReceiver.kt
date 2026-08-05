package com.alliminate.android.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.alliminate.android.service.UnlockApprovalRegistry

/** Wired to the Approve/Decline actions on an unlock-approval request notification. */
class UnlockRequestReceiver : BroadcastReceiver() {
    companion object {
        const val EXTRA_REQUEST_ID = "unlockRequestId"
        const val EXTRA_ACCEPT = "unlockAccept"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val requestId = intent.getStringExtra(EXTRA_REQUEST_ID) ?: return
        val accept = intent.getBooleanExtra(EXTRA_ACCEPT, false)
        UnlockApprovalRegistry.respond(requestId, accept)
        TransferNotifications.clearUnlockRequest(context, requestId)
    }
}
