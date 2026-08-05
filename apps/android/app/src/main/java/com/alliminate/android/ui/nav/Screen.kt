package com.alliminate.android.ui.nav

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Sync
import androidx.compose.ui.graphics.vector.ImageVector

/** Android gets a mobile-scoped nav, not a 1:1 clone of the Mac sidebar — Files/Pinned Folders/Google
 * Photos/Trash/file-type categories were desktop-only concepts with no real function here (browsing a
 * Master Device's clouds already covers "Files"; there's no separate local Trash or Google Photos OAuth
 * on the phone). Every tab below has an actual working screen behind it. */
sealed class Screen(val route: String, val label: String, val icon: ImageVector) {
    object Overview : Screen("overview", "Overview", Icons.Filled.Home)
    object Devices : Screen("devices", "Devices", Icons.Filled.Devices)
    object CloudServices : Screen("cloud_services", "Cloud Services", Icons.Filled.Cloud)
    object Share : Screen("share", "Share", Icons.Filled.Share)
    object Settings : Screen("settings", "Settings", Icons.Filled.Settings)
    object Sync : Screen("sync", "Sync", Icons.Filled.Sync)

    companion object {
        val primaryNav = listOf(Overview, Devices, CloudServices, Share)
    }
}
