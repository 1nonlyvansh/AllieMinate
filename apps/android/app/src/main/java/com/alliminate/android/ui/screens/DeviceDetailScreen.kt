package com.alliminate.android.ui.screens

import android.net.Uri
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BatteryFull
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alliminate.android.R
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.BatteryInfo
import com.alliminate.android.data.Downloads
import com.alliminate.android.data.LocalFolderListing
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.PairedMaster
import com.alliminate.android.data.PairingStatus
import com.alliminate.android.data.Prefs
import com.alliminate.android.data.RemoteFile
import com.alliminate.android.data.RemoteFolder
import com.alliminate.android.service.LocalServerService
import com.alliminate.android.ui.components.EmptyStateCard
import com.alliminate.android.ui.components.GlassCard
import com.alliminate.android.ui.components.ScreenScaffold
import com.alliminate.android.ui.theme.LocalAllieMinateColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val BATTERY_POLL_MS = 15_000L
private const val MAX_SEND_FILES = 30

private fun fileNameOf(context: android.content.Context, uri: Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0) return cursor.getString(idx)
        }
    }
    return uri.lastPathSegment ?: "file"
}

@Composable
fun DeviceDetailScreen(master: PairedMaster, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val colors = LocalAllieMinateColors.current

    // PairedMaster passed in is a snapshot at nav time — read live state so a rename/toggle from this same
    // screen (which mutates Prefs.pairedMasters) is reflected immediately instead of showing stale values.
    val live = Prefs.pairedMasters.firstOrNull { it.id == master.id } ?: master
    val isApple = live.platform == "darwin"

    var battery by remember { mutableStateOf<ApiResult<BatteryInfo>?>(null) }
    LaunchedEffect(live.id) {
        while (true) {
            battery = MasterApi.battery(live.host, live.token)
            delay(BATTERY_POLL_MS)
        }
    }

    var exploreOpen by remember { mutableStateOf(false) }
    var settingsOpen by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var renameText by remember { mutableStateOf(live.name) }
    var sending by remember { mutableStateOf(false) }
    var sendStatus by remember { mutableStateOf<String?>(null) }

    val sendLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        val batch = uris.take(MAX_SEND_FILES)
        if (uris.size > MAX_SEND_FILES) {
            Toast.makeText(context, "Only the first $MAX_SEND_FILES files are sent per batch", Toast.LENGTH_LONG).show()
        }
        sending = true
        scope.launch {
            var okCount = 0
            batch.forEach { uri ->
                val name = fileNameOf(context, uri)
                sendStatus = "Sending $name…"
                val input = context.contentResolver.openInputStream(uri)
                if (input != null) {
                    val result = MasterApi.uploadStreamToInbox(live.host, live.token, name, input)
                    if (result is ApiResult.Ok) okCount++
                }
            }
            sending = false
            sendStatus = "Sent $okCount/${batch.size} file${if (batch.size == 1) "" else "s"} to ${live.name}"
        }
    }

    fun unpair() {
        // Clear locally FIRST, notify the paired PC after — see DevicesScreen's original comment on this
        // exact tradeoff: this phone can't force the other side to agree regardless of ordering, so
        // there's no correctness reason to make the user wait on a network round-trip before anything
        // visibly changes.
        Prefs.clearPairing(live.id)
        if (!Prefs.isPaired) LocalServerService.stop(context)
        PairingStatus.isError.value = false
        PairingStatus.message.value = "Unpaired from ${live.name}"
        onBack()
        scope.launch {
            val removedOnMaster = MasterApi.unpair(live.host, live.token, Prefs.deviceId)
            if (!removedOnMaster) {
                PairingStatus.isError.value = true
                PairingStatus.message.value = "Unpaired here, but couldn't reach ${live.name} — remove it there too from Devices"
            }
        }
    }

    ScreenScaffold(live.name, onBack) {
        // Header: platform logo + name, centered.
        Column(modifier = Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                painter = painterResource(if (isApple) R.drawable.ic_platform_apple else R.drawable.ic_platform_windows),
                contentDescription = null,
                // Apple's glyph is a plain black silhouette (no real "brand color") — tint it to the
                // theme's own foreground so it stays visible in dark mode instead of vanishing into a
                // black-on-near-black background. Windows' logo is genuinely multi-color, so it keeps its
                // own fillColors untouched (Unspecified = no tint override).
                tint = if (isApple) MaterialTheme.colorScheme.onBackground else androidx.compose.ui.graphics.Color.Unspecified,
                modifier = Modifier.size(48.dp),
            )
            Text(live.name, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Medium)
            Text(if (isApple) "macOS" else "Windows", style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceSecondary)
        }

        // Live battery.
        GlassCard {
            Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Filled.BatteryFull, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                when (val b = battery) {
                    null -> Text("Checking battery…", style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceSecondary)
                    is ApiResult.Err -> Text("Battery not available on ${live.name}", style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceTertiary)
                    is ApiResult.Ok -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("${b.value.percent}%", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        if (b.value.charging) {
                            Icon(Icons.Filled.Bolt, contentDescription = "Charging", tint = colors.online, modifier = Modifier.size(18.dp))
                            Text("Charging", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceSecondary)
                        }
                    }
                }
            }
        }

        // Explore <Name>'s Files.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(colors.surfaceStrong)
                .clickable { exploreOpen = !exploreOpen }
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(Icons.Filled.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text("Explore ${live.name}'s Files", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = colors.onSurfaceTertiary)
        }
        if (exploreOpen) {
            ExploreFilesSection(master = live)
        }

        // Send Files to <Name>.
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(colors.surfaceStrong)
                    .clickable(enabled = !sending) { sendLauncher.launch("*/*") }
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (sending) CircularProgressIndicator(modifier = Modifier.size(20.dp)) else Icon(Icons.Filled.CloudUpload, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(modifier = Modifier.weight(1f)) {
                    Text("Send Files to ${live.name}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                    Text("Any file type, up to $MAX_SEND_FILES at a time", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceSecondary)
                }
            }
            sendStatus?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceSecondary, modifier = Modifier.padding(top = 6.dp, start = 4.dp))
            }
        }

        // Settings.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(colors.surfaceStrong)
                .clickable { settingsOpen = !settingsOpen }
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(Icons.Filled.Settings, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text("Settings", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = colors.onSurfaceTertiary)
        }
        if (settingsOpen) {
            GlassCard {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    // Rename.
                    if (renaming) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(value = renameText, onValueChange = { renameText = it }, label = { Text("Device name") }, modifier = Modifier.fillMaxWidth())
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = {
                                    Prefs.renameMaster(live.id, renameText)
                                    renaming = false
                                }) { Text("Save") }
                                TextButton(onClick = { renaming = false; renameText = live.name }) { Text("Cancel") }
                            }
                        }
                    } else {
                        Row(
                            modifier = Modifier.fillMaxWidth().clickable { renaming = true },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Icon(Icons.Filled.Edit, contentDescription = null, tint = colors.onSurfaceSecondary)
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Rename", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                                Text(live.name, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceSecondary)
                            }
                        }
                    }

                    // Universal Clipboard toggle.
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Filled.ContentPaste, contentDescription = null, tint = colors.onSurfaceSecondary)
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Universal Clipboard", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                            Text("Copy on either device, paste on the other", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceSecondary)
                        }
                        Switch(checked = live.universalClipboardEnabled, onCheckedChange = { Prefs.setUniversalClipboardEnabled(live.id, it) })
                    }

                    // Let this device see my files toggle.
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Filled.VisibilityOff, contentDescription = null, tint = colors.onSurfaceSecondary)
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Let ${live.name} see my files", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                            Text("Off blocks this device from browsing your phone's files", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceSecondary)
                        }
                        Switch(checked = live.shareFilesWithMaster, onCheckedChange = { Prefs.setShareFilesWithMaster(live.id, it) })
                    }

                    // Unpair.
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable { unpair() },
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(Icons.Filled.LinkOff, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                        Text("Unpair ${live.name}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

@Composable
private fun ExploreFilesSection(master: PairedMaster) {
    val colors = LocalAllieMinateColors.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var shortcuts by remember(master.id) { mutableStateOf<ApiResult<List<RemoteFolder>>?>(null) }
    LaunchedEffect(master.id) { shortcuts = MasterApi.localFolders(master.host, master.token) }

    // null = still at the shortcut list; non-null = inside a shortcut, browsing folderId/subPath.
    var activeFolderId by remember { mutableStateOf<String?>(null) }
    var activeFolderName by remember { mutableStateOf("") }
    var subPath by remember { mutableStateOf("") }
    var listing by remember { mutableStateOf<ApiResult<LocalFolderListing>?>(null) }

    fun browse(folderId: String, name: String, path: String) {
        activeFolderId = folderId
        activeFolderName = name
        subPath = path
        listing = null
        scope.launch { listing = MasterApi.browseLocalFolder(master.host, master.token, folderId, path.ifBlank { null }) }
    }

    // Tap-to-preview before deciding to pull a file down — images render inline; video hands off to the
    // phone's own video player (via a cached FileProvider Uri) rather than reimplementing a player here.
    // Anything else has no preview story, so tapping the name just falls through to the same download the
    // row's download icon already does.
    var previewTarget by remember { mutableStateOf<RemoteFile?>(null) }
    var previewBitmap by remember { mutableStateOf<android.graphics.Bitmap?>(null) }
    var previewLoading by remember { mutableStateOf(false) }
    var previewError by remember { mutableStateOf<String?>(null) }

    fun openPreview(folderId: String, file: RemoteFile) {
        val mime = file.mimeType.orEmpty()
        if (!mime.startsWith("image/") && !mime.startsWith("video/")) return // no inline preview for this type
        previewTarget = file
        previewBitmap = null
        previewError = null
        previewLoading = true
        scope.launch {
            val result = MasterApi.downloadLocalFolderFile(master.host, master.token, folderId, file.path)
            previewLoading = false
            when (result) {
                is ApiResult.Ok -> {
                    if (mime.startsWith("image/")) {
                        previewBitmap = android.graphics.BitmapFactory.decodeByteArray(result.value, 0, result.value.size)
                        if (previewBitmap == null) previewError = "Couldn't decode this image"
                    } else {
                        val cacheFile = java.io.File(context.cacheDir, file.displayName)
                        cacheFile.writeBytes(result.value)
                        val uri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", cacheFile)
                        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, mime)
                            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        runCatching { context.startActivity(intent) }
                            .onFailure { previewError = "No app found to play this video" }
                        previewTarget = null
                    }
                }
                is ApiResult.Err -> previewError = result.message
            }
        }
    }

    previewTarget?.let { file ->
        if (file.mimeType?.startsWith("image/") == true) {
            androidx.compose.ui.window.Dialog(onDismissRequest = { previewTarget = null }) {
                Column(
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(colors.surfaceStrong).padding(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(file.displayName, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                    when {
                        previewLoading -> CircularProgressIndicator()
                        previewError != null -> Text(previewError ?: "", style = MaterialTheme.typography.bodySmall, color = colors.offline)
                        previewBitmap != null -> androidx.compose.foundation.Image(
                            bitmap = previewBitmap!!.asImageBitmap(),
                            contentDescription = file.displayName,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    TextButton(onClick = { previewTarget = null }) { Text("Close") }
                }
            }
        }
    }

    GlassCard {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val folderId = activeFolderId
            if (folderId == null) {
                when (val s = shortcuts) {
                    null -> Text("Loading…", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceTertiary)
                    is ApiResult.Err -> Text("${master.name} is offline right now", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceTertiary)
                    is ApiResult.Ok -> if (s.value.isEmpty()) {
                        Text("No folders shared from ${master.name} yet", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceTertiary)
                    } else {
                        s.value.forEach { f ->
                            Row(
                                modifier = Modifier.fillMaxWidth().clickable { browse(f.id, f.name, "") },
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Icon(Icons.Filled.Folder, contentDescription = null, tint = colors.onSurfaceSecondary, modifier = Modifier.size(20.dp))
                                Text(f.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = colors.onSurfaceTertiary)
                            }
                        }
                    }
                }
            } else {
                // Breadcrumb.
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { activeFolderId = null }) { Text("← All Folders") }
                }
                Text(
                    if (subPath.isBlank()) activeFolderName else "$activeFolderName / ${subPath.split('/').joinToString(" / ")}",
                    style = MaterialTheme.typography.labelSmall,
                    color = colors.onSurfaceTertiary,
                )
                when (val l = listing) {
                    null -> Text("Loading…", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceTertiary)
                    is ApiResult.Err -> Text(l.message, style = MaterialTheme.typography.bodySmall, color = colors.offline)
                    is ApiResult.Ok -> {
                        if (l.value.folders.isEmpty() && l.value.files.isEmpty()) {
                            Text("Empty folder", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceTertiary)
                        }
                        l.value.folders.forEach { f ->
                            Row(
                                modifier = Modifier.fillMaxWidth().clickable { browse(activeFolderId!!, activeFolderName, f.path) },
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                Icon(Icons.Filled.Folder, contentDescription = null, tint = colors.onSurfaceSecondary, modifier = Modifier.size(20.dp))
                                Text(f.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = colors.onSurfaceTertiary)
                            }
                        }
                        l.value.files.forEach { file ->
                            var downloading by remember(file.path) { mutableStateOf(false) }
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Icon(Icons.Filled.InsertDriveFile, contentDescription = null, tint = colors.onSurfaceSecondary, modifier = Modifier.size(20.dp))
                                Text(
                                    file.displayName,
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.weight(1f).clickable { openPreview(activeFolderId!!, file) }
                                )
                                if (downloading) {
                                    CircularProgressIndicator(modifier = Modifier.size(18.dp))
                                } else {
                                    Icon(
                                        Icons.Filled.Download,
                                        contentDescription = "Download",
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(20.dp).clickable {
                                            downloading = true
                                            scope.launch {
                                                val result = MasterApi.downloadLocalFolderFile(master.host, master.token, activeFolderId!!, file.path)
                                                downloading = false
                                                if (result is ApiResult.Ok) {
                                                    Downloads.save(context, file.displayName, file.mimeType ?: "application/octet-stream", result.value)
                                                    Toast.makeText(context, "Saved ${file.displayName}", Toast.LENGTH_SHORT).show()
                                                } else {
                                                    Toast.makeText(context, "Couldn't download ${file.displayName}", Toast.LENGTH_SHORT).show()
                                                }
                                            }
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
