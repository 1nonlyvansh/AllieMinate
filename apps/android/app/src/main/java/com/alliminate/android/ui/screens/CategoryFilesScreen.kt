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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.North
import androidx.compose.material.icons.filled.South
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.Downloads
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.Prefs
import com.alliminate.android.data.RemoteFile
import com.alliminate.android.ui.components.EmptyStateCard
import com.alliminate.android.ui.components.GlassCard
import com.alliminate.android.ui.components.ScreenHeader
import com.alliminate.android.ui.components.ScreenScaffold
import com.alliminate.android.ui.theme.LocalAllieMinateColors
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

enum class SortField { SIZE, DATE }

data class CategoryFile(val file: RemoteFile, val providerId: String, val providerLabel: String)

private val CATEGORY_EXTENSIONS = mapOf(
    "image" to setOf("jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp"),
    "video" to setOf("mp4", "mov", "mkv", "avi", "webm", "m4v", "3gp"),
    "audio" to setOf("mp3", "wav", "m4a", "flac", "aac", "ogg", "opus"),
    "document" to setOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf"),
    "archive" to setOf("zip", "rar", "7z", "tar", "gz"),
)
val CATEGORY_TITLES = mapOf("image" to "Photos", "video" to "Videos", "audio" to "Audio", "document" to "Documents", "archive" to "Archives")
val CATEGORY_ICONS: Map<String, ImageVector> = mapOf(
    "image" to Icons.Filled.Image,
    "video" to Icons.Filled.Videocam,
    "audio" to Icons.Filled.MusicNote,
    "document" to Icons.Filled.Description,
    "archive" to Icons.Filled.Archive,
)

private fun matchesCategory(name: String, category: String): Boolean {
    val ext = name.substringAfterLast('.', "").lowercase()
    return ext in (CATEGORY_EXTENSIONS[category] ?: emptySet())
}

/** Aggregates one file-type category across EVERY cloud service connected on the Master Device — the
 * Android counterpart to the desktop app's Files > category views. Fetched by browsing each provider in
 * parallel and filtering/sorting client-side (no new backend route needed — this reuses the exact same
 * /providers/:id/browse-style call CloudServicesScreen already makes per account). */
@Composable
fun CategoryFilesScreen(category: String, onBack: () -> Unit) {
    val host = Prefs.masterHost.value
    val token = Prefs.masterToken.value
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var allFiles by remember { mutableStateOf<List<CategoryFile>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var availableProviders by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var selectedProviders by remember { mutableStateOf<Set<String>?>(null) } // null = every provider included
    var sortField by remember { mutableStateOf(SortField.DATE) }
    var sortAscending by remember { mutableStateOf(false) }
    var showFilter by remember { mutableStateOf(false) }
    var downloadingPath by remember { mutableStateOf<String?>(null) }

    val legacyPermissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }

    LaunchedEffect(host, token, category) {
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
        val labeled = providers.map { id -> id to (driveLabels[id] ?: PROVIDER_LABEL[baseProviderOf(id)] ?: id) }
        availableProviders = labeled

        val results = coroutineScope {
            labeled.map { (id, label) ->
                async {
                    when (val r = MasterApi.browseProvider(host, token, id)) {
                        is ApiResult.Ok -> r.value.filter { matchesCategory(it.displayName, category) }.map { CategoryFile(it, id, label) }
                        is ApiResult.Err -> emptyList()
                    }
                }
            }.awaitAll()
        }
        allFiles = results.flatten()
    }

    val visibleFiles = remember(allFiles, selectedProviders, sortField, sortAscending) {
        val base = allFiles ?: emptyList()
        val chosen = selectedProviders
        val filtered = if (chosen == null) base else base.filter { it.providerId in chosen }
        val sorted = when (sortField) {
            SortField.SIZE -> filtered.sortedBy { it.file.size }
            SortField.DATE -> filtered.sortedBy { it.file.modifiedAt }
        }
        if (sortAscending) sorted else sorted.reversed()
    }

    fun downloadAndOpen(cf: CategoryFile) {
        if (host == null || token == null) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            legacyPermissionLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            return
        }
        downloadingPath = cf.file.path
        scope.launch {
            when (val result = MasterApi.downloadBytes(host, token, cf.providerId, cf.file.path)) {
                is ApiResult.Ok -> {
                    val mime = Downloads.guessMimeType(cf.file.displayName, cf.file.mimeType)
                    val uri = Downloads.save(context, cf.file.displayName, mime, result.value)
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

    val title = CATEGORY_TITLES[category] ?: category

    ScreenScaffold(title, onBack) {
        ScreenHeader(title, "Every ${title.lowercase()} file across your connected clouds.")

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val filterCount = selectedProviders?.size ?: availableProviders.size
            FilterChip(
                selected = selectedProviders != null,
                onClick = { showFilter = true },
                label = { Text(if (selectedProviders != null) "Filter ($filterCount)" else "All Services") },
            )
            FilterChip(
                selected = false,
                onClick = { sortField = if (sortField == SortField.DATE) SortField.SIZE else SortField.DATE },
                label = { Text(if (sortField == SortField.DATE) "Date" else "Size") },
            )
            IconButton(onClick = { sortAscending = !sortAscending }) {
                Icon(if (sortAscending) Icons.Filled.North else Icons.Filled.South, contentDescription = if (sortAscending) "Ascending" else "Descending")
            }
        }

        if (error != null) EmptyStateCard(CATEGORY_ICONS[category] ?: Icons.Filled.Description, error!!)
        if (error == null && allFiles == null) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { CircularProgressIndicator() }
        }
        if (allFiles != null && visibleFiles.isEmpty()) {
            EmptyStateCard(CATEGORY_ICONS[category] ?: Icons.Filled.Description, "No $title found across your connected clouds.")
        }

        visibleFiles.forEach { cf ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(LocalAllieMinateColors.current.surfaceStrong)
                    .clickable { downloadAndOpen(cf) }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(CATEGORY_ICONS[category] ?: Icons.Filled.Description, contentDescription = null, tint = LocalAllieMinateColors.current.onSurfaceSecondary)
                Column(modifier = Modifier.weight(1f)) {
                    Text(cf.file.displayName, style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "${cf.providerLabel} · ${formatFileBytes(cf.file.size)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = LocalAllieMinateColors.current.onSurfaceSecondary,
                    )
                }
                if (downloadingPath == cf.file.path) {
                    CircularProgressIndicator(modifier = Modifier.padding(4.dp))
                } else {
                    IconButton(onClick = { downloadAndOpen(cf) }) {
                        Icon(Icons.Filled.Download, contentDescription = "Download")
                    }
                }
            }
        }
    }

    if (showFilter) {
        val working = remember(showFilter) { mutableStateOf(selectedProviders ?: availableProviders.map { it.first }.toSet()) }
        AlertDialog(
            onDismissRequest = { showFilter = false },
            title = { Text("Filter by Cloud Service") },
            text = {
                Column {
                    availableProviders.forEach { (id, label) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    working.value = if (id in working.value) working.value - id else working.value + id
                                },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = id in working.value, onCheckedChange = { checked ->
                                working.value = if (checked) working.value + id else working.value - id
                            })
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    selectedProviders = if (working.value.size == availableProviders.size) null else working.value
                    showFilter = false
                }) { Text("Apply") }
            },
            dismissButton = { TextButton(onClick = { showFilter = false }) { Text("Cancel") } },
        )
    }
}

private fun formatFileBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt().coerceIn(0, units.size - 1)
    return String.format("%.1f %s", bytes / Math.pow(1024.0, digitGroups.toDouble()), units[digitGroups])
}
