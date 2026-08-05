package com.alliminate.android.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.SpaceDashboard
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alliminate.android.data.AccountInfo
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.Prefs
import com.alliminate.android.ui.components.EmptyStateCard
import com.alliminate.android.ui.components.GlassCard
import com.alliminate.android.ui.components.GlobalSearchBar
import com.alliminate.android.ui.components.IconBadge
import com.alliminate.android.ui.components.ScreenHeader
import com.alliminate.android.ui.components.ScreenScaffold
import com.alliminate.android.ui.components.StatusDot
import com.alliminate.android.ui.components.glassSurface
import com.alliminate.android.ui.theme.LocalAllieMinateColors
import kotlinx.coroutines.delay

private const val OVERVIEW_PING_INTERVAL_MS = 6000L

@Composable
fun OverviewScreen(onOpenDrawer: () -> Unit, onNavigate: (String) -> Unit = {}) {
    val host = Prefs.masterHost.value
    val token = Prefs.masterToken.value
    val name = Prefs.masterName.value
    val context = LocalContext.current

    var masterOnline by remember { mutableStateOf<Boolean?>(null) }
    var accounts by remember { mutableStateOf<List<AccountInfo>?>(null) }

    LaunchedEffect(host, token) {
        if (host == null || token == null) {
            masterOnline = null
            return@LaunchedEffect
        }
        while (true) {
            masterOnline = MasterApi.ping(host, token)
            delay(OVERVIEW_PING_INTERVAL_MS)
        }
    }

    LaunchedEffect(host, token) {
        if (host == null || token == null) return@LaunchedEffect
        accounts = when (val r = MasterApi.accounts(host, token)) {
            is ApiResult.Ok -> r.value
            is ApiResult.Err -> emptyList()
        }
    }

    val allFilesAccessGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()
    val powerManager = remember { context.getSystemService(Context.POWER_SERVICE) as PowerManager }
    val batteryUnrestricted = powerManager.isIgnoringBatteryOptimizations(context.packageName)

    ScreenScaffold("Overview", onOpenDrawer) {
        ScreenHeader("Overview", "This phone and what it's connected to.")

        if (host == null || token == null) {
            EmptyStateCard(Icons.Filled.SpaceDashboard, "Pair with your Mac or Windows PC in Devices to get started.")
        } else {
            GlobalSearchBar(host, token)

            GlassCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onNavigate("devices") }
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    IconBadge(Icons.Filled.Devices)
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Paired with ${name ?: "Master Device"}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            val online = masterOnline
                            StatusDot(
                                when (online) {
                                    true -> LocalAllieMinateColors.current.online
                                    false -> LocalAllieMinateColors.current.offline
                                    null -> LocalAllieMinateColors.current.onSurfaceTertiary
                                },
                            )
                            Text(
                                when (online) {
                                    true -> "Online"
                                    false -> "Offline"
                                    null -> "Checking…"
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = LocalAllieMinateColors.current.onSurfaceSecondary,
                            )
                        }
                    }
                }
            }

            Text("BROWSE BY TYPE", style = MaterialTheme.typography.labelSmall, color = LocalAllieMinateColors.current.onSurfaceTertiary)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CategoryTile("image", Modifier.weight(1f)) { onNavigate("category/image") }
                CategoryTile("video", Modifier.weight(1f)) { onNavigate("category/video") }
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CategoryTile("audio", Modifier.weight(1f)) { onNavigate("category/audio") }
                CategoryTile("document", Modifier.weight(1f)) { onNavigate("category/document") }
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CategoryTile("archive", Modifier.weight(1f)) { onNavigate("category/archive") }
                androidx.compose.foundation.layout.Spacer(modifier = Modifier.weight(1f))
            }

            GlassCard {
                Column(modifier = Modifier.padding(vertical = 4.dp)) {
                    StatusRow(
                        title = "Documents & Archives Access",
                        subtitle = if (allFilesAccessGranted) "Your Master Device can browse this phone's documents and archives" else "Tap to grant — Documents/Archives stay empty without it",
                        healthy = allFilesAccessGranted,
                        onClick = {
                            if (!allFilesAccessGranted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                                context.startActivity(
                                    Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${context.packageName}")),
                                )
                            } else {
                                onNavigate("settings")
                            }
                        },
                    )
                    StatusRow(
                        title = "Background Sync",
                        subtitle = if (batteryUnrestricted) "Unrestricted — sync keeps running while the screen is locked" else "Tap to exempt — without this, sync can pause a few minutes after lock",
                        healthy = batteryUnrestricted,
                        onClick = {
                            if (!batteryUnrestricted) {
                                context.startActivity(
                                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}")),
                                )
                            } else {
                                onNavigate("settings")
                            }
                        },
                        showDivider = false,
                    )
                }
            }
        }

        if (host != null) {
            Text("CONNECTED CLOUD SERVICES", style = MaterialTheme.typography.labelSmall, color = LocalAllieMinateColors.current.onSurfaceTertiary)
            GlassCard {
                Column(modifier = Modifier.padding(vertical = 4.dp)) {
                    when {
                        accounts == null -> Row(
                            modifier = Modifier.fillMaxWidth().padding(20.dp),
                            horizontalArrangement = Arrangement.Center,
                        ) { CircularProgressIndicator() }
                        accounts!!.isEmpty() -> Text(
                            "No cloud services connected on your Master Device yet.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = LocalAllieMinateColors.current.onSurfaceSecondary,
                            modifier = Modifier.padding(16.dp),
                        )
                        else -> accounts!!.forEachIndexed { index, account ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onNavigate("cloud_services") }
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                val dotColor = PROVIDER_COLOR[account.provider] ?: MaterialTheme.colorScheme.primary
                                androidx.compose.foundation.layout.Box(
                                    modifier = Modifier.size(10.dp).clip(CircleShape).background(dotColor),
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(account.label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                    Text(
                                        PROVIDER_LABEL[account.provider] ?: account.provider,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = LocalAllieMinateColors.current.onSurfaceSecondary,
                                    )
                                }
                            }
                            if (index < accounts!!.lastIndex) {
                                androidx.compose.foundation.layout.Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 16.dp)
                                        .background(LocalAllieMinateColors.current.hairline)
                                        .height(1.dp),
                                )
                            }
                        }
                    }
                }
            }
        }

        Text("QUICK ACTIONS", style = MaterialTheme.typography.labelSmall, color = LocalAllieMinateColors.current.onSurfaceTertiary)
        QuickAction(Icons.Filled.Cloud, "Browse Cloud Services", "See files on your Master Device") { onNavigate("cloud_services") }
        QuickAction(Icons.Filled.Share, "Share a File", "Send a file to a cloud on your Master Device") { onNavigate("share") }
        QuickAction(Icons.Filled.Devices, "Devices", "Pairing, status, and USB connection") { onNavigate("devices") }
    }
}

@Composable
private fun StatusRow(title: String, subtitle: String, healthy: Boolean, onClick: () -> Unit, showDivider: Boolean = true) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            StatusDot(if (healthy) LocalAllieMinateColors.current.online else LocalAllieMinateColors.current.warning)
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary)
            }
        }
        if (showDivider) {
            androidx.compose.foundation.layout.Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .background(LocalAllieMinateColors.current.hairline)
                    .height(1.dp),
            )
        }
    }
}

@Composable
private fun CategoryTile(category: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier = modifier
            .glassSurface()
            .clickable(onClick = onClick)
            .padding(vertical = 18.dp, horizontal = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconBadge(CATEGORY_ICONS[category] ?: Icons.Filled.Cloud)
        Text(CATEGORY_TITLES[category] ?: category, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun QuickAction(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .glassSurface()
            .clickable(onClick = onClick)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        IconBadge(icon)
        Column {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary)
        }
    }
}
