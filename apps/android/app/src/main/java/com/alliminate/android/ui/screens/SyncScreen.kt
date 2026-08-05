package com.alliminate.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.Prefs
import com.alliminate.android.data.SyncActivityStore
import com.alliminate.android.data.SyncFileStateStore
import com.alliminate.android.data.SyncPair
import com.alliminate.android.data.SyncPairStore
import com.alliminate.android.data.TreeFolderNode
import com.alliminate.android.service.SyncFileObservers
import com.alliminate.android.ui.components.EmptyStateCard
import com.alliminate.android.ui.components.GlassCard
import com.alliminate.android.ui.components.ScreenHeader
import com.alliminate.android.ui.components.ScreenScaffold
import com.alliminate.android.ui.theme.LocalAllieMinateColors
import com.alliminate.android.work.SyncPushScheduler
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

@Composable
fun SyncScreen(onOpenDrawer: () -> Unit) {
    var pairs by remember { mutableStateOf(SyncPairStore.list()) }
    var showAddFlow by remember { mutableStateOf(false) }
    var activityTick by remember { mutableStateOf(0) }
    val context = LocalContext.current

    fun refresh() {
        pairs = SyncPairStore.list()
        activityTick++
        SyncFileObservers.refresh() // watched-folder set changed — pick it up immediately, don't wait
        // for LocalServerService to next restart before this pair's folder gets watched.
    }

    if (showAddFlow) {
        AddSyncPairFlow(
            onDismiss = { showAddFlow = false },
            onCreated = {
                showAddFlow = false
                refresh()
                SyncPushScheduler.runOnce(context)
                SyncPushScheduler.start(context)
            },
        )
        return
    }

    ScreenScaffold("Sync", onOpenDrawer) {
        ScreenHeader("Sync", "Phone folders that automatically push to a cloud folder via your Master Device.")

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(LocalAllieMinateColors.current.surfaceStrong)
                .clickable { showAddFlow = true }
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Icon(Icons.Filled.Add, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text("Add Sync Pair", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        }

        if (pairs.isEmpty()) {
            EmptyStateCard(Icons.Filled.Sync, "No folders syncing yet. Add one above to push a phone folder to a cloud account automatically.")
        } else {
            pairs.forEach { pair ->
                SyncPairCard(pair = pair, onChanged = { refresh() })
            }
        }

        val activity = remember(activityTick) { SyncActivityStore.list() }
        if (activity.isNotEmpty()) {
            Text("RECENT ACTIVITY", style = MaterialTheme.typography.labelSmall, color = LocalAllieMinateColors.current.onSurfaceTertiary)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 220.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(LocalAllieMinateColors.current.surfaceStrong)
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                val fmt = remember { SimpleDateFormat("HH:mm", Locale.getDefault()) }
                activity.take(40).forEach { entry ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                        Text(
                            fmt.format(Date(entry.timestamp)),
                            style = MaterialTheme.typography.bodySmall,
                            color = LocalAllieMinateColors.current.onSurfaceTertiary,
                        )
                        Text(
                            entry.text,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (entry.isError) LocalAllieMinateColors.current.offline else LocalAllieMinateColors.current.onSurfaceSecondary,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SyncPairCard(pair: SyncPair, onChanged: () -> Unit) {
    val colors = LocalAllieMinateColors.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val paused = pair.status == "paused"

    GlassCard {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Filled.Sync, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(pair.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                    Text(
                        "${pair.localPath} → ${pair.providerLabel} / ${pair.remoteFolderName}",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceSecondary,
                    )
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    if (paused) "Paused" else "Active",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (paused) colors.onSurfaceTertiary else colors.online,
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = {
                    SyncPairStore.update(pair.id) { it.copy(status = if (paused) "active" else "paused") }
                    onChanged()
                }) {
                    Icon(if (paused) Icons.Filled.PlayArrow else Icons.Filled.Pause, contentDescription = null)
                    Text(if (paused) " Resume" else " Pause")
                }
                TextButton(onClick = { SyncPushScheduler.runOnce(context) }) {
                    Icon(Icons.Filled.Sync, contentDescription = null)
                    Text(" Sync Now")
                }
                TextButton(onClick = {
                    // Deleting a pair used to just forget it locally — every file it ever pushed stayed in
                    // the cloud folder forever with nothing left on the phone to say which files were its.
                    // Read the synced-file list (and cascade-trash them on the Master) BEFORE clearing that
                    // state — SyncPairStore.remove() wipes SyncFileStateStore for this pair as its last step.
                    val host = Prefs.masterHost.value
                    val token = Prefs.masterToken.value
                    val syncedNames = SyncFileStateStore.load(pair.id)
                        .filterValues { it.status == "synced" }
                        .keys
                        .toList()
                    if (host != null && token != null && syncedNames.isNotEmpty()) {
                        scope.launch {
                            when (val r = MasterApi.trashMany(host, token, pair.providerId, syncedNames)) {
                                is ApiResult.Ok -> SyncActivityStore.record(pair.id, "Moved ${syncedNames.size} synced files to Trash")
                                is ApiResult.Err -> SyncActivityStore.record(pair.id, "Couldn't move synced files to Trash: ${r.message}", isError = true)
                            }
                        }
                    }
                    SyncPairStore.remove(pair.id)
                    onChanged()
                }) {
                    Icon(Icons.Filled.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Text(" Delete", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Add Sync Pair — a 3-step flow: pick a phone folder, pick a cloud account, pick a folder in it.
// Every step reuses the same full-screen shell so this doesn't need a cramped dialog for folder
// browsing, matching how CloudFileBrowser takes over the whole screen rather than living in a modal.
// ---------------------------------------------------------------------------------------------

// Plain nullable state threaded through 4 screens instead of a sealed step type — which folder/provider
// fields are non-null is exactly what determines which screen shows, no separate "current step" enum
// needed on top of that.
@Composable
private fun AddSyncPairFlow(onDismiss: () -> Unit, onCreated: () -> Unit) {
    var localPath by remember { mutableStateOf<String?>(null) }
    var providerId by remember { mutableStateOf<String?>(null) }
    var providerLabel by remember { mutableStateOf<String?>(null) }
    var remoteFolderId by remember { mutableStateOf<String?>(null) }
    var remoteFolderName by remember { mutableStateOf<String?>(null) }
    var remotePicked by remember { mutableStateOf(false) }

    val path = localPath
    val pid = providerId
    val plabel = providerLabel

    when {
        path == null -> LocalFolderPicker(onCancel = onDismiss, onPicked = { localPath = it })
        pid == null || plabel == null -> ProviderPicker(
            onCancel = onDismiss,
            onPicked = { id, label -> providerId = id; providerLabel = label },
        )
        !remotePicked -> RemoteFolderPicker(
            providerId = pid,
            providerLabel = plabel,
            onCancel = onDismiss,
            onPicked = { folderId, folderName ->
                remoteFolderId = folderId
                remoteFolderName = folderName
                remotePicked = true
            },
        )
        else -> ConfirmSyncPair(
            localPath = path,
            providerId = pid,
            providerLabel = plabel,
            remoteFolderId = remoteFolderId,
            remoteFolderName = remoteFolderName ?: plabel,
            onCancel = onDismiss,
            onCreated = onCreated,
        )
    }
}

@Composable
private fun LocalFolderPicker(onCancel: () -> Unit, onPicked: (String) -> Unit) {
    val root = remember { android.os.Environment.getExternalStorageDirectory() }
    var current by remember { mutableStateOf(root) }

    PickerScaffold(title = "Choose a phone folder", subtitle = current.absolutePath, onCancel = onCancel) {
        val parent = current.parentFile
        if (parent != null && current.absolutePath != root.absolutePath && current.absolutePath.startsWith(root.absolutePath)) {
            PickerRow(icon = Icons.Filled.ChevronRight, label = ".. (up)", onClick = { current = parent })
        }

        val subfolders = remember(current) {
            (current.listFiles { f -> f.isDirectory && !f.name.startsWith(".") } ?: emptyArray())
                .sortedBy { it.name.lowercase() }
        }
        if (subfolders.isEmpty()) {
            EmptyStateCard(Icons.Filled.Folder, "No subfolders here.")
        } else {
            subfolders.forEach { folder ->
                PickerRow(icon = Icons.Filled.Folder, label = folder.name, onClick = { current = folder })
            }
        }

        TextButton(onClick = { onPicked(current.absolutePath) }, modifier = Modifier.fillMaxWidth()) {
            Text("Use \"${current.name.ifBlank { "Internal Storage" }}\"")
        }
    }
}

@Composable
private fun ProviderPicker(onCancel: () -> Unit, onPicked: (String, String) -> Unit) {
    val host = Prefs.masterHost.value
    val token = Prefs.masterToken.value
    var accounts by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(host, token) {
        if (host == null || token == null) {
            error = "Not paired with a Master Device"
            return@LaunchedEffect
        }
        val providersResult = MasterApi.listProviders(host, token)
        val providers = when (providersResult) {
            is ApiResult.Ok -> providersResult.value
            is ApiResult.Err -> {
                error = providersResult.message
                return@LaunchedEffect
            }
        }
        val labels = when (val r = MasterApi.accounts(host, token)) {
            is ApiResult.Ok -> r.value.associate { it.accountId to it.label }
            is ApiResult.Err -> emptyMap()
        }
        accounts = providers.map { id -> id to (labels[id] ?: PROVIDER_LABEL[baseProviderOf(id)] ?: id) }
    }

    PickerScaffold(title = "Choose a cloud account", subtitle = "Files will push here from your phone", onCancel = onCancel) {
        when {
            error != null -> EmptyStateCard(Icons.Filled.Sync, error!!)
            accounts == null -> CircularProgressIndicator()
            accounts!!.isEmpty() -> EmptyStateCard(Icons.Filled.Sync, "No cloud accounts connected on your Master Device yet.")
            else -> accounts!!.forEach { (id, label) ->
                PickerRow(icon = Icons.Filled.ChevronRight, label = label, onClick = { onPicked(id, label) })
            }
        }
    }
}

@Composable
private fun RemoteFolderPicker(providerId: String, providerLabel: String, onCancel: () -> Unit, onPicked: (String?, String) -> Unit) {
    val host = Prefs.masterHost.value
    val token = Prefs.masterToken.value
    var crumbs by remember { mutableStateOf(listOf(TreeFolderNode(id = "", name = providerLabel))) }
    var folders by remember { mutableStateOf<List<TreeFolderNode>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshTick by remember { mutableStateOf(0) }
    var showCreateDialog by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val currentId = crumbs.last().id.ifBlank { null }
    LaunchedEffect(currentId, refreshTick) {
        if (host == null || token == null) {
            error = "Not paired with a Master Device"
            return@LaunchedEffect
        }
        folders = null
        when (val r = MasterApi.browseTree(host, token, providerId, currentId)) {
            is ApiResult.Ok -> folders = r.value.folders
            is ApiResult.Err -> error = r.message
        }
    }

    PickerScaffold(
        title = "Choose a folder in $providerLabel",
        subtitle = crumbs.joinToString(" / ") { it.name },
        onCancel = onCancel,
    ) {
        if (crumbs.size > 1) {
            PickerRow(icon = Icons.Filled.ChevronRight, label = ".. (up)", onClick = { crumbs = crumbs.dropLast(1) })
        }
        PickerRow(icon = Icons.Filled.Add, label = "Create Folder", onClick = { showCreateDialog = true })

        when {
            error != null -> EmptyStateCard(Icons.Filled.Folder, error!!)
            folders == null -> CircularProgressIndicator()
            folders!!.isEmpty() -> EmptyStateCard(Icons.Filled.Folder, "No subfolders here.")
            else -> folders!!.forEach { folder ->
                PickerRow(icon = Icons.Filled.Folder, label = folder.name, onClick = { crumbs = crumbs + folder })
            }
        }

        TextButton(onClick = { onPicked(currentId, crumbs.last().name) }, modifier = Modifier.fillMaxWidth()) {
            Text("Use \"${crumbs.last().name}\"")
        }
    }

    if (showCreateDialog) {
        CreateFolderDialog(
            creating = { name, onDone ->
                if (host == null || token == null) {
                    onDone("Not paired with a Master Device")
                } else {
                    scope.launch {
                        when (val r = MasterApi.createFolder(host, token, providerId, currentId, name)) {
                            is ApiResult.Ok -> {
                                showCreateDialog = false
                                refreshTick++
                            }
                            is ApiResult.Err -> onDone(r.message)
                        }
                    }
                }
            },
            onDismiss = { showCreateDialog = false },
        )
    }
}

@Composable
private fun CreateFolderDialog(creating: (name: String, onDone: (error: String?) -> Unit) -> Unit, onDismiss: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var inFlight by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New Folder") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Folder name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank() && !inFlight,
                onClick = {
                    inFlight = true
                    creating(name.trim()) { err ->
                        inFlight = false
                        error = err
                    }
                },
            ) {
                Text(if (inFlight) "Creating…" else "Create")
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun ConfirmSyncPair(
    localPath: String,
    providerId: String,
    providerLabel: String,
    remoteFolderId: String?,
    remoteFolderName: String,
    onCancel: () -> Unit,
    onCreated: () -> Unit,
) {
    var name by remember { mutableStateOf(File(localPath).name.ifBlank { "Sync" }) }
    val fmt = remember { SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()) }

    PickerScaffold(title = "Name this Sync Pair", subtitle = "$localPath → $providerLabel / $remoteFolderName", onCancel = onCancel) {
        OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())

        TextButton(
            onClick = {
                SyncPairStore.add(
                    SyncPair(
                        id = "${System.currentTimeMillis()}-${(0..9999).random()}",
                        name = name.ifBlank { File(localPath).name },
                        localPath = localPath,
                        providerId = providerId,
                        providerLabel = providerLabel,
                        remoteFolderId = remoteFolderId,
                        remoteFolderName = remoteFolderName,
                        status = "active",
                        createdAt = fmt.format(Date()),
                    ),
                )
                onCreated()
            },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Create Sync Pair")
        }
    }
}

@Composable
private fun PickerScaffold(title: String, subtitle: String, onCancel: () -> Unit, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            IconButton(onClick = onCancel) {
                Icon(Icons.Filled.Close, contentDescription = "Cancel")
            }
            Column {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary)
            }
        }
        Column(
            modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            content = content,
        )
    }
}

@Composable
private fun PickerRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LocalAllieMinateColors.current.surfaceStrong)
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}
