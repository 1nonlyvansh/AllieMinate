package com.alliminate.android.ui.screens

import android.Manifest
import android.content.Intent
import android.os.Build
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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.OfflinePin
import androidx.compose.material.icons.outlined.OfflinePin
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.core.content.ContextCompat
import com.alliminate.android.data.AccountInfo
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.Downloads
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.OfflineFile
import com.alliminate.android.data.OfflineManifest
import com.alliminate.android.data.Prefs
import com.alliminate.android.data.RemoteFile
import com.alliminate.android.data.TreeFolderNode
import com.alliminate.android.ui.components.EmptyStateCard
import com.alliminate.android.ui.components.ScreenHeader
import com.alliminate.android.ui.components.ScreenScaffold
import com.alliminate.android.ui.theme.LocalAllieMinateColors
import kotlinx.coroutines.launch

// providers connected but not backed by a labeled "account" (only Drive accounts have real labels via
// /accounts — matches the desktop CloudServicesView's own PROVIDER_LABEL fallback map exactly). Shared
// (not private) — ShareScreen.kt's loadCloudAccounts() and SettingsScreen.kt's backup picker reuse these.
val PROVIDER_LABEL = mapOf(
    "b2" to "Backblaze B2",
    "idrive-e2" to "IDrive e2",
    "google-drive" to "Google Drive",
    "mega" to "MEGA",
    "pcloud" to "pCloud",
    "onedrive" to "OneDrive",
)

// ported from the desktop app's PROVIDER_COLOR map — used for the small provider dot on Overview's
// Connected Cloud Services card so the phone's account list reads visually consistent with the Mac's.
val PROVIDER_COLOR = mapOf(
    "b2" to androidx.compose.ui.graphics.Color(0xFFE2231A),
    "idrive-e2" to androidx.compose.ui.graphics.Color(0xFF0F9D58),
    "google-drive" to androidx.compose.ui.graphics.Color(0xFF4285F4),
    "mega" to androidx.compose.ui.graphics.Color(0xFFD9272E),
    "pcloud" to androidx.compose.ui.graphics.Color(0xFF17BFEA),
    "onedrive" to androidx.compose.ui.graphics.Color(0xFF0078D4),
)

fun baseProviderOf(id: String): String = id.substringBefore(':')

@Composable
fun CloudServicesScreen(onOpenDrawer: () -> Unit) {
    // browses whichever PC was paired first — with more than one paired, the others' clouds aren't
    // reachable from this screen yet (no cross-PC cloud aggregation UI exists).
    val host = Prefs.primaryMaster?.host
    val token = Prefs.primaryMaster?.token

    var accounts by remember { mutableStateOf<List<AccountInfo>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var openAccount by remember { mutableStateOf<AccountInfo?>(null) }

    LaunchedEffect(host, token) {
        if (host == null || token == null) return@LaunchedEffect
        val providersResult = MasterApi.listProviders(host, token)
        val providers = when (providersResult) {
            is ApiResult.Ok -> providersResult.value
            is ApiResult.Err -> {
                error = providersResult.message
                return@LaunchedEffect
            }
        }
        val driveLabels = when (val r = MasterApi.accounts(host, token)) {
            is ApiResult.Ok -> r.value.associate { it.accountId to it.label }
            is ApiResult.Err -> emptyMap()
        }
        accounts = providers.map { id ->
            val label = driveLabels[id] ?: PROVIDER_LABEL[baseProviderOf(id)] ?: id
            AccountInfo(accountId = id, label = label, provider = baseProviderOf(id))
        }
    }

    if (host == null || token == null) {
        ScreenScaffold("Cloud Services", onOpenDrawer) {
            ScreenHeader("Cloud Services", "Every cloud account signed in on your Master Device.")
            EmptyStateCard(Icons.Filled.Cloud, "Pair with your Mac or Windows PC in Devices to see its connected clouds here.")
        }
        return
    }

    val open = openAccount
    if (open != null) {
        CloudFileBrowser(host = host, token = token, account = open, onBack = { openAccount = null })
        return
    }

    val context = LocalContext.current
    var offlineFiles by remember { mutableStateOf(OfflineManifest.list()) }

    ScreenScaffold("Cloud Services", onOpenDrawer) {
        ScreenHeader("Cloud Services", "Every cloud account signed in on your Master Device.")

        if (offlineFiles.isNotEmpty()) {
            Text("OFFLINE FILES", style = MaterialTheme.typography.labelSmall, color = LocalAllieMinateColors.current.onSurfaceTertiary)
            offlineFiles.forEach { file ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(LocalAllieMinateColors.current.surfaceStrong)
                        .clickable {
                            val intent = Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(android.net.Uri.parse(file.localUri), file.mimeType)
                                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                            }
                            runCatching { context.startActivity(intent) }
                        }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Icon(Icons.Filled.OfflinePin, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text(file.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    IconButton(onClick = {
                        OfflineManifest.remove(file.accountId, file.key)
                        offlineFiles = OfflineManifest.list()
                    }) {
                        Icon(Icons.Outlined.OfflinePin, contentDescription = "Remove from offline files")
                    }
                }
            }
        }

        if (error != null) EmptyStateCard(Icons.Filled.Cloud, error!!)
        if (error == null && accounts == null) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() }
        }
        if (accounts != null && accounts!!.isEmpty()) {
            EmptyStateCard(Icons.Filled.Cloud, "No cloud services connected on your Master Device yet.")
        }
        accounts?.forEach { account ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(LocalAllieMinateColors.current.surfaceStrong)
                    .clickable { openAccount = account }
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(Icons.Filled.Cloud, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column {
                    Text(account.label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                    Text(account.provider, style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary)
                }
            }
        }
    }
}

private data class TreeCrumb(val id: String?, val name: String)

@Composable
private fun CloudFileBrowser(host: String, token: String, account: AccountInfo, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var crumbs by remember { mutableStateOf(listOf(TreeCrumb(id = null, name = account.label))) }
    var folders by remember { mutableStateOf<List<TreeFolderNode>>(emptyList()) }
    var files by remember { mutableStateOf<List<RemoteFile>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var downloadingPath by remember { mutableStateOf<String?>(null) }
    var pinningPath by remember { mutableStateOf<String?>(null) }
    var offlineKeys by remember { mutableStateOf(OfflineManifest.list().filter { it.accountId == account.accountId }.map { it.key }.toSet()) }

    val legacyPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    val currentFolderId = crumbs.last().id

    // Finder-style tree browse, one level at a time — same /providers/:id/tree route the desktop upload
    // picker uses, so a folder here is the account's actual folder object, not a flattened key prefix.
    // Falls back to the old flat /browse listing only if this provider doesn't support real folders at all
    // (browseTree surfaces that as an error, matching the desktop's own "folder browsing not supported").
    LaunchedEffect(account.accountId, currentFolderId) {
        error = null
        when (val result = MasterApi.browseTree(host, token, account.accountId, currentFolderId)) {
            is ApiResult.Ok -> {
                folders = result.value.folders
                files = result.value.files
            }
            is ApiResult.Err -> {
                folders = emptyList()
                when (val flat = MasterApi.browseProvider(host, token, account.accountId)) {
                    is ApiResult.Ok -> files = flat.value
                    is ApiResult.Err -> error = flat.message
                }
            }
        }
    }

    fun enterFolder(folder: TreeFolderNode) {
        crumbs = crumbs + TreeCrumb(id = folder.id, name = folder.name)
    }

    fun jumpToCrumb(index: Int) {
        crumbs = crumbs.subList(0, index + 1).toList()
    }

    fun downloadAndOpen(file: RemoteFile) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            legacyPermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        downloadingPath = file.path
        scope.launch {
            when (val result = MasterApi.downloadBytes(host, token, account.accountId, file.path)) {
                is ApiResult.Ok -> {
                    val mime = Downloads.guessMimeType(file.displayName, file.mimeType)
                    val uri = Downloads.save(context, file.displayName, mime, result.value)
                    downloadingPath = null
                    if (uri != null) {
                        val intent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, mime)
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                        }
                        runCatching { context.startActivity(intent) }
                    }
                }
                is ApiResult.Err -> {
                    downloadingPath = null
                    error = result.message
                }
            }
        }
    }

    fun toggleOffline(file: RemoteFile) {
        if (offlineKeys.contains(file.path)) {
            OfflineManifest.remove(account.accountId, file.path)
            offlineKeys = offlineKeys - file.path
            return
        }
        pinningPath = file.path
        scope.launch {
            when (val result = MasterApi.downloadBytes(host, token, account.accountId, file.path)) {
                is ApiResult.Ok -> {
                    val mime = Downloads.guessMimeType(file.displayName, file.mimeType)
                    val uri = Downloads.saveOffline(context, file.displayName, result.value)
                    pinningPath = null
                    if (uri != null) {
                        OfflineManifest.add(OfflineFile(account.accountId, file.path, file.displayName, uri.toString(), file.size, mime))
                        offlineKeys = offlineKeys + file.path
                    }
                }
                is ApiResult.Err -> {
                    pinningPath = null
                    error = result.message
                }
            }
        }
    }

    val scaffoldBack: () -> Unit = if (crumbs.size > 1) ({ jumpToCrumb(crumbs.size - 2) }) else onBack
    ScreenScaffold(crumbs.last().name, scaffoldBack) {
        ScreenHeader(account.label, "Files in this cloud — tap a folder to open it, tap a file to download and open.")

        if (crumbs.size > 1) {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                crumbs.forEachIndexed { index, crumb ->
                    if (index > 0) Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = LocalAllieMinateColors.current.onSurfaceTertiary, modifier = Modifier.width(16.dp))
                    Text(
                        crumb.name,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (index == crumbs.lastIndex) LocalAllieMinateColors.current.onSurfaceSecondary else MaterialTheme.colorScheme.primary,
                        modifier = if (index == crumbs.lastIndex) Modifier else Modifier.clickable { jumpToCrumb(index) },
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                }
            }
        }

        if (error != null) EmptyStateCard(Icons.Filled.InsertDriveFile, error!!)
        if (error == null && files == null) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() }
        }
        if (files != null && files!!.isEmpty() && folders.isEmpty()) {
            EmptyStateCard(Icons.Filled.InsertDriveFile, "No files in this cloud.")
        }
        folders.forEach { folder ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(LocalAllieMinateColors.current.surfaceStrong)
                    .clickable { enterFolder(folder) }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(Icons.Filled.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text(folder.name, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = LocalAllieMinateColors.current.onSurfaceTertiary)
            }
        }
        files?.forEach { file ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(LocalAllieMinateColors.current.surfaceStrong)
                    .clickable { downloadAndOpen(file) }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(Icons.Filled.InsertDriveFile, contentDescription = null, tint = LocalAllieMinateColors.current.onSurfaceSecondary)
                Column(modifier = Modifier.weight(1f)) {
                    Text(file.displayName, style = MaterialTheme.typography.bodyMedium)
                    Text(formatBytes(file.size), style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary)
                }
                if (pinningPath == file.path) {
                    CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                } else {
                    IconButton(onClick = { toggleOffline(file) }) {
                        Icon(
                            if (offlineKeys.contains(file.path)) Icons.Filled.OfflinePin else Icons.Outlined.OfflinePin,
                            contentDescription = if (offlineKeys.contains(file.path)) "Remove from offline files" else "Keep available offline",
                            tint = if (offlineKeys.contains(file.path)) MaterialTheme.colorScheme.primary else LocalAllieMinateColors.current.onSurfaceSecondary,
                        )
                    }
                }
                if (downloadingPath == file.path) {
                    CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                } else {
                    IconButton(onClick = { downloadAndOpen(file) }) {
                        Icon(Icons.Filled.Download, contentDescription = "Download")
                    }
                }
            }
        }
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt().coerceIn(0, units.size - 1)
    return String.format("%.1f %s", bytes / Math.pow(1024.0, digitGroups.toDouble()), units[digitGroups])
}
