package com.alliminate.android.data

import android.net.Uri
import androidx.compose.runtime.mutableStateOf

/** Holds a file Uri handed to AllieMinate via the Android share-sheet until ShareScreen picks it up and
 * clears it. `mode` tracks which of the two share-sheet entries ("Save File to Cloud" vs "Send to
 * Connected Devices") the user tapped, since both land on the same MainActivity via activity-aliases. */
object SharedFileHolder {
    val pendingUri = mutableStateOf<Uri?>(null)
    val mode = mutableStateOf("cloud")
}
