package com.alliminate.android.data

import androidx.compose.runtime.mutableStateOf

/** Transient feedback for pairing flows that don't have a normal UI to update directly — currently just
 * the USB deep-link auto-pair, which happens via an incoming Intent with no dialog on screen to show
 * progress in. DevicesScreen surfaces this as a banner and clears it after a few seconds. */
object PairingStatus {
    val message = mutableStateOf<String?>(null)
    val isError = mutableStateOf(false)
}
