package com.alliminate.android.data

import androidx.compose.runtime.mutableStateOf

data class PairRequest(val host: String, val code: String, val macName: String)

/** A USB pairing deep link that's arrived but not yet confirmed — shown as a full-screen "Connect
 * <macName>?" Yes/No + fingerprint gate (UsbPairConfirmScreen) rather than pairing silently. */
object PendingPairRequest {
    val current = mutableStateOf<PairRequest?>(null)
}
