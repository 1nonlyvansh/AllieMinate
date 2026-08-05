package com.alliminate.android.data

import androidx.compose.runtime.mutableStateOf

/** A route to jump straight to once the app is up — set by the Quick Share widget's tap intent. */
object PendingRoute {
    val route = mutableStateOf<String?>(null)
}
