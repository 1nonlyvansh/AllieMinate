package com.alliminate.android.ui.screens

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alliminate.android.data.AccountInfo
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.Prefs
import com.alliminate.android.data.SharedFileHolder
import com.alliminate.android.ui.components.EmptyStateCard
import com.alliminate.android.ui.components.ScreenHeader
import com.alliminate.android.ui.components.ScreenScaffold
import com.alliminate.android.ui.theme.LocalAllieMinateColors
import kotlinx.coroutines.launch

// same cap the desktop upload picker and backend enforce — see StorageBackend/putInFolder callers.
private const val MAX_SHARE_BYTES = 5L * 1024 * 1024 * 1024

/** Real cloud-service list with the user's own custom Drive account labels from the Mac app (not just a
 * generic "Google Drive" repeated once per linked account) — same merge CloudServicesScreen.kt uses. */
suspend fun loadCloudAccounts(host: String, token: String): ApiResult<List<AccountInfo>> {
    val providers = when (val r = MasterApi.listProviders(host, token)) {
        is ApiResult.Ok -> r.value
        is ApiResult.Err -> return r
    }
    val driveLabels = when (val r = MasterApi.accounts(host, token)) {
        is ApiResult.Ok -> r.value.associate { it.accountId to it.label }
        is ApiResult.Err -> emptyMap()
    }
    return ApiResult.Ok(
        providers.map { id ->
            val label = driveLabels[id] ?: PROVIDER_LABEL[baseProviderOf(id)] ?: id
            AccountInfo(accountId = id, label = label, provider = baseProviderOf(id))
        },
    )
}

@Composable
private fun ShareModeTab(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary else LocalAllieMinateColors.current.surfaceStrong)
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = if (selected) MaterialTheme.colorScheme.onPrimary else LocalAllieMinateColors.current.onSurfaceSecondary, modifier = Modifier.padding(end = 6.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = if (selected) MaterialTheme.colorScheme.onPrimary else LocalAllieMinateColors.current.onSurfaceSecondary)
    }
}

private fun fileNameOf(context: android.content.Context, uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0) return cursor.getString(idx)
        }
    }
    return uri.lastPathSegment ?: "file"
}

/** Throttles to one notification update per whole percentage point — a 5GB file at 64KB chunks is ~80,000
 * copy iterations, and NotificationManagerCompat.notify() on every single one would be both wasteful and
 * visibly janky. */
private fun progressReporter(context: android.content.Context, name: String, totalBytes: Long): (Long) -> Unit {
    var lastPercent = -1
    return { sent ->
        val percent = if (totalBytes > 0) ((sent * 100) / totalBytes).toInt().coerceIn(0, 100) else 0
        if (percent != lastPercent) {
            lastPercent = percent
            com.alliminate.android.notifications.TransferNotifications.showProgress(context, name, percent)
        }
    }
}

private fun fileSizeOf(context: android.content.Context, uri: Uri): Long {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val idx = cursor.getColumnIndex(OpenableColumns.SIZE)
            if (idx >= 0 && !cursor.isNull(idx)) return cursor.getLong(idx)
        }
    }
    return -1L
}

@Composable
fun ShareScreen(onOpenDrawer: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val host = Prefs.masterHost.value
    val token = Prefs.masterToken.value

    var pickedUri by remember { mutableStateOf<Uri?>(null) }
    var pickedName by remember { mutableStateOf<String?>(null) }
    var accounts by remember { mutableStateOf<List<AccountInfo>?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<String?>(null) }
    val deviceMode = SharedFileHolder.mode.value == "device"

    val pickLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            pickedUri = uri
            pickedName = fileNameOf(context, uri)
            result = null
        }
    }

    LaunchedEffect(host, token) {
        if (host == null || token == null) return@LaunchedEffect
        when (val r = loadCloudAccounts(host, token)) {
            is ApiResult.Ok -> accounts = r.value
            is ApiResult.Err -> result = r.message
        }
    }

    // arrived via Android's share-sheet — pre-fill the pick step instead of making the user browse for
    // the same file again. `mode` distinguishes "Save File to Cloud" from "Send to Connected Devices".
    LaunchedEffect(Unit) {
        val pending = SharedFileHolder.pendingUri.value
        if (pending != null) {
            pickedUri = pending
            pickedName = fileNameOf(context, pending)
            SharedFileHolder.pendingUri.value = null
        } else {
            SharedFileHolder.mode.value = "cloud" // opened manually, not via a share-sheet alias — default view
        }
    }

    fun oversized(uri: Uri): Boolean {
        val size = fileSizeOf(context, uri)
        return size >= 0 && size > MAX_SHARE_BYTES
    }

    fun uploadTo(account: AccountInfo) {
        val uri = pickedUri ?: return
        val name = pickedName ?: return
        if (host == null || token == null) return
        if (oversized(uri)) {
            result = "That file is over the 5GB transfer limit"
            return
        }
        uploading = true
        scope.launch {
            val input = context.contentResolver.openInputStream(uri)
            if (input == null) {
                uploading = false
                result = "couldn't read that file"
                return@launch
            }
            val totalBytes = fileSizeOf(context, uri)
            when (val r = MasterApi.uploadStreamToProvider(host, token, account.accountId, name, input, progressReporter(context, name, totalBytes))) {
                is ApiResult.Ok -> {
                    uploading = false
                    result = "Sent \"$name\" to ${account.label}"
                    com.alliminate.android.notifications.TransferNotifications.showSendResult(context, name, account.label, success = true)
                    pickedUri = null
                    pickedName = null
                }
                is ApiResult.Err -> {
                    uploading = false
                    result = r.message
                    com.alliminate.android.notifications.TransferNotifications.showSendResult(context, name, account.label, success = false, error = r.message)
                }
            }
        }
    }

    fun sendToDevice() {
        val uri = pickedUri ?: return
        val name = pickedName ?: return
        if (host == null || token == null) return
        if (oversized(uri)) {
            result = "That file is over the 5GB transfer limit"
            return
        }
        uploading = true
        scope.launch {
            val input = context.contentResolver.openInputStream(uri)
            if (input == null) {
                uploading = false
                result = "couldn't read that file"
                return@launch
            }
            val totalBytes = fileSizeOf(context, uri)
            val destName = Prefs.masterName.value ?: "your Master Device"
            when (val r = MasterApi.uploadStreamToInbox(host, token, name, input, progressReporter(context, name, totalBytes))) {
                is ApiResult.Ok -> {
                    uploading = false
                    result = "Sent \"$name\" to $destName"
                    com.alliminate.android.notifications.TransferNotifications.showSendResult(context, name, destName, success = true)
                    pickedUri = null
                    pickedName = null
                }
                is ApiResult.Err -> {
                    uploading = false
                    result = r.message
                    com.alliminate.android.notifications.TransferNotifications.showSendResult(context, name, destName, success = false, error = r.message)
                }
            }
        }
    }

    ScreenScaffold("Share", onOpenDrawer) {
        ScreenHeader(
            "Share",
            if (deviceMode) "Send a file straight to your Master Device." else "Send a file from this phone to a cloud on your Master Device.",
        )

        if (host == null || token == null) {
            EmptyStateCard(Icons.Filled.UploadFile, "Pair with your Mac or Windows PC in Devices to share files there.")
            return@ScreenScaffold
        }

        if (pickedUri == null) {
            Button(onClick = { pickLauncher.launch("*/*") }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.UploadFile, contentDescription = null)
                Text("  Choose a file to share")
            }
        } else {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(LocalAllieMinateColors.current.surfaceStrong)
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(Icons.Filled.InsertDriveFile, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text(pickedName ?: "", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            }

            // manual switch — the share-sheet (Save File to Cloud / Send to Connected Devices) sets this
            // automatically, but opening Share from the drawer needs its own way to reach "device" mode
            // too, not just cloud.
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ShareModeTab(
                    icon = Icons.Filled.Cloud,
                    label = "Save to Cloud",
                    selected = !deviceMode,
                    onClick = { SharedFileHolder.mode.value = "cloud" },
                    modifier = Modifier.weight(1f),
                )
                ShareModeTab(
                    icon = Icons.Filled.Devices,
                    label = "Send to Device",
                    selected = deviceMode,
                    onClick = { SharedFileHolder.mode.value = "device" },
                    modifier = Modifier.weight(1f),
                )
            }

            if (deviceMode) {
                Text("Send to", style = MaterialTheme.typography.labelSmall, color = LocalAllieMinateColors.current.onSurfaceTertiary)
                if (uploading) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() }
                } else {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(14.dp))
                            .background(LocalAllieMinateColors.current.surfaceStrong)
                            .clickable { sendToDevice() }
                            .padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        Icon(Icons.Filled.Devices, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Text(Prefs.masterName.value ?: "Your Master Device", style = MaterialTheme.typography.bodyMedium)
                    }
                }
            } else {
                Text("Choose a cloud on your Master Device", style = MaterialTheme.typography.labelSmall, color = LocalAllieMinateColors.current.onSurfaceTertiary)

                if (uploading) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() }
                } else {
                    accounts?.forEach { account ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(LocalAllieMinateColors.current.surfaceStrong)
                                .clickable { uploadTo(account) }
                                .padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(14.dp),
                        ) {
                            Icon(Icons.Filled.Cloud, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Text(account.label, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    if (accounts != null && accounts!!.isEmpty()) {
                        EmptyStateCard(Icons.Filled.Cloud, "No cloud services connected on your Master Device yet.")
                    }
                }
            }
        }

        result?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary) }
    }
}
