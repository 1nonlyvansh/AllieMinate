package com.alliminate.android.data

import androidx.compose.runtime.mutableStateOf

data class ContinuityPayload(
    val fromName: String,
    val fileName: String,
    val providerId: String,
    val key: String,
    val mimeType: String?,
)

/** Set by MainActivity when a "Continue on this phone?" notification is tapped; consumed once by a
 * LaunchedEffect in AllieMinateContent to download the same file from the paired Master Device and open
 * it directly — same one-shot holder pattern as SharedFileHolder/PendingRoute. */
object ContinuityHolder {
    val pending = mutableStateOf<ContinuityPayload?>(null)
}
