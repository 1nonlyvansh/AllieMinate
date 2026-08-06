package com.alliminate.android.ui.screens

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BatteryChargingFull
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.core.content.ContextCompat
import com.alliminate.android.data.AccountInfo
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.Prefs
import com.alliminate.android.ui.components.ScreenHeader
import com.alliminate.android.ui.components.ScreenScaffold
import com.alliminate.android.ui.theme.LocalAllieMinateColors
import com.alliminate.android.work.CameraBackupScheduler

@Composable
fun SettingsScreen(onOpenDrawer: () -> Unit) {
    val context = LocalContext.current

    ScreenScaffold("Settings", onOpenDrawer) {
        ScreenHeader("Settings", "App lock, notifications, and power settings for AllieMinate on Android.")

        SettingsSection("Security") {
            AppLockRow(context)
        }

        SettingsSection("Notifications") {
            NotificationsRow(context)
        }

        SettingsSection("Devices") {
            PhotoAccessRow(context)
            VideoAccessRow(context)
            AudioAccessRow(context)
            AllFilesAccessRow(context)
        }

        SettingsSection("Sharing") {
            NearbyShareRow(context)
        }

        SettingsSection("Backup") {
            CameraBackupSection(context)
        }

        SettingsSection("Power") {
            BatteryOptimizationRow(context)
        }

        SettingsSection("About") {
            SettingsRow(icon = Icons.Filled.Info, title = "Version", subtitle = "AllieMinate for Android 0.1.0 (foundation build)")
        }
    }
}

@Composable
private fun SettingsSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            title.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = LocalAllieMinateColors.current.onSurfaceTertiary,
            modifier = Modifier.padding(start = 4.dp, bottom = 6.dp),
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(LocalAllieMinateColors.current.surfaceStrong),
            content = content,
        )
    }
}

@Composable
private fun SettingsRow(
    icon: ImageVector,
    title: String,
    subtitle: String,
    trailing: @Composable (() -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary)
        }
        trailing?.invoke()
    }
}

@Composable
private fun AppLockRow(context: Context) {
    val biometricManager = remember { BiometricManager.from(context) }
    val canUseBiometrics = remember {
        biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
    }
    val subtitle = if (canUseBiometrics) {
        "Require fingerprint or face unlock to open AllieMinate"
    } else {
        "No biometric hardware enrolled on this device"
    }
    SettingsRow(
        icon = Icons.Filled.Fingerprint,
        title = "App Lock",
        subtitle = subtitle,
        trailing = {
            Switch(
                checked = Prefs.appLockEnabled.value && canUseBiometrics,
                onCheckedChange = { Prefs.setAppLockEnabled(it) },
                enabled = canUseBiometrics,
            )
        },
    )
}

@Composable
private fun NotificationsRow(context: Context) {
    var granted by remember {
        mutableStateOf(
            Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED,
        )
    }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
        granted = isGranted
    }
    SettingsRow(
        icon = Icons.Filled.Notifications,
        title = "Notifications",
        subtitle = if (granted) "Sync and transfer alerts enabled" else "Get notified when files finish syncing or transferring",
        trailing = {
            Switch(
                checked = granted,
                onCheckedChange = { checked ->
                    if (checked && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        granted = checked
                    }
                },
            )
        },
    )
}

private fun photoPermission(): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.READ_MEDIA_IMAGES else Manifest.permission.READ_EXTERNAL_STORAGE

private fun videoPermission(): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.READ_MEDIA_VIDEO else Manifest.permission.READ_EXTERNAL_STORAGE

private fun audioPermission(): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE

@Composable
private fun MediaAccessRow(context: Context, icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, mediaKind: String, permission: String) {
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, permission) == android.content.pm.PackageManager.PERMISSION_GRANTED)
    }
    val requestLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { isGranted ->
        granted = isGranted
    }
    // an Android runtime permission can't be revoked by the app itself — requestPermissions() can only
    // ASK, never take one back. The switch used to fake an "off" state locally on tap (granted = false)
    // without touching the real OS permission at all, which was actively misleading: the phone's actual
    // access was still on, and the next recompose (or app relaunch) would just read the real permission
    // and flip the switch back on anyway. Route to this app's system Settings page instead, where the user
    // can really turn it off, and re-read the real permission state on return.
    val settingsLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        granted = ContextCompat.checkSelfPermission(context, permission) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }
    SettingsRow(
        icon = icon,
        title = title,
        subtitle = if (granted) "Your Master Device can browse this phone's $mediaKind — tap to turn off" else "Let your paired Mac or Windows PC browse this phone's $mediaKind",
        onClick = {
            if (!granted) {
                requestLauncher.launch(permission)
            } else {
                settingsLauncher.launch(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
            }
        },
        trailing = { Switch(checked = granted, onCheckedChange = null) },
    )
}

@Composable
private fun PhotoAccessRow(context: Context) = MediaAccessRow(context, Icons.Filled.PhotoLibrary, "Photo Library Access", "photos", photoPermission())

@Composable
private fun VideoAccessRow(context: Context) = MediaAccessRow(context, Icons.Filled.VideoLibrary, "Video Library Access", "videos", videoPermission())

@Composable
private fun AudioAccessRow(context: Context) = MediaAccessRow(context, Icons.Filled.LibraryMusic, "Audio Library Access", "audio", audioPermission())

@Composable
private fun CameraBackupSection(context: Context) {
    // backs up to whichever PC was paired first — with more than one paired, the others' clouds aren't
    // reachable as a backup destination yet (no cross-PC cloud aggregation UI exists).
    val master = Prefs.primaryMaster
    val host = master?.host
    val token = master?.token
    var accounts by remember { mutableStateOf<List<AccountInfo>?>(null) }
    var showPicker by remember { mutableStateOf(false) }

    LaunchedEffect(host, token, showPicker) {
        if (host == null || token == null || !showPicker) return@LaunchedEffect
        when (val r = loadCloudAccounts(host, token)) {
            is ApiResult.Ok -> accounts = r.value
            is ApiResult.Err -> {}
        }
    }

    Column {
        SettingsRow(
            icon = Icons.Filled.CloudUpload,
            title = "Camera Backup",
            subtitle = Prefs.backupFolderName.value?.let { "Backs up new photos to $it on WiFi" }
                ?: "Choose a cloud service below first",
            trailing = {
                Switch(
                    checked = Prefs.backupEnabled.value,
                    enabled = Prefs.backupFolderId.value != null,
                    onCheckedChange = { checked ->
                        Prefs.setBackupEnabled(checked)
                        if (checked) CameraBackupScheduler.start(context) else CameraBackupScheduler.stop(context)
                    },
                )
            },
        )
        SettingsRow(
            icon = Icons.Filled.PhotoLibrary,
            title = "Backup Destination",
            subtitle = Prefs.backupFolderName.value ?: "Not set — pair a device first",
            onClick = { if (host != null && token != null) showPicker = true },
        )
    }

    if (showPicker) {
        AlertDialog(
            onDismissRequest = { showPicker = false },
            title = { Text("Choose a cloud service") },
            text = {
                Column {
                    (accounts ?: emptyList()).forEach { account ->
                        Text(
                            account.label,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    Prefs.setBackupFolder(master?.id, account.accountId, account.label)
                                    showPicker = false
                                }
                                .padding(vertical = 12.dp),
                        )
                    }
                    if (accounts != null && accounts!!.isEmpty()) {
                        Text("No cloud services connected on your Master Device yet.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { showPicker = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun AllFilesAccessRow(context: Context) {
    var granted by remember { mutableStateOf(hasAllFilesAccess()) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        granted = hasAllFilesAccess()
    }
    SettingsRow(
        icon = Icons.Filled.Folder,
        title = "Documents & Archives Access",
        subtitle = if (granted) "Your Master Device can browse this phone's documents and archives — tap to turn off" else "Let your paired Mac or Windows PC see real documents and archives, not just media",
        // this system screen shows the SAME on/off switch regardless of current state — previously only
        // launching it while ungranted meant there was no way back to turn it off once granted, short of
        // digging through system Settings manually.
        onClick = {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:${context.packageName}"))
                launcher.launch(intent)
            }
        },
        trailing = { Switch(checked = granted, onCheckedChange = null) },
    )
}

// plain local preference, no OS permission involved — unlike the media/all-files access rows above, this
// toggles instantly with no system intent round-trip.
@Composable
private fun NearbyShareRow(context: Context) {
    SettingsRow(
        icon = Icons.Filled.Share,
        title = "Nearby Share",
        subtitle = if (Prefs.nearbyShareEnabled.value) "Discoverable to any AllieMinate device on this WiFi — no pairing needed, you approve each transfer" else "Not discoverable — other devices won't see this phone in Nearby Share",
        trailing = {
            Switch(
                checked = Prefs.nearbyShareEnabled.value,
                onCheckedChange = { enabled ->
                    Prefs.setNearbyShareEnabled(enabled)
                    if (enabled) com.alliminate.android.service.LocalServerService.start(context)
                },
            )
        },
    )
}

private fun hasAllFilesAccess(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()

@Composable
private fun BatteryOptimizationRow(context: Context) {
    val powerManager = remember { context.getSystemService(Context.POWER_SERVICE) as PowerManager }
    var ignoring by remember { mutableStateOf(powerManager.isIgnoringBatteryOptimizations(context.packageName)) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        ignoring = powerManager.isIgnoringBatteryOptimizations(context.packageName)
    }
    SettingsRow(
        icon = Icons.Filled.BatteryChargingFull,
        title = "Background Sync",
        subtitle = if (ignoring) "Unrestricted — tap to manage in system Battery settings" else "Exempt AllieMinate from battery optimization for reliable sync",
        onClick = {
            // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS only has a grant path — there's no "un-request"
            // version of it, and firing it again once already exempt is unreliable across OEMs (some just
            // no-op with nothing to request). The app's own system Settings page → Battery is the one place
            // that reliably lets the user dial it back to Optimized/Restricted themselves.
            val intent = if (!ignoring) {
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
            } else {
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
            }
            launcher.launch(intent)
        },
        trailing = { Switch(checked = ignoring, onCheckedChange = null) },
    )
}
