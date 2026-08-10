package com.alliminate.android.ui.screens

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.DriveFileMove
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
import com.alliminate.android.data.Downloads
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.MasterSyncPair
import com.alliminate.android.data.PairedMaster
import com.alliminate.android.data.Prefs
import com.alliminate.android.data.RemoteFile
import com.alliminate.android.data.SyncActivityStore
import com.alliminate.android.data.SyncFileStateStore
import com.alliminate.android.data.SyncPair
import com.alliminate.android.data.SyncPairStore
import com.alliminate.android.data.TreeFolderNode
import com.alliminate.android.data.UniversalSyncInvite
import com.alliminate.android.data.UniversalSyncInviteStore
import com.alliminate.android.service.SyncFileObservers
import com.alliminate.android.ui.components.DeviceAuth
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun SyncScreen(onOpenDrawer: () -> Unit) {
    var pairs by remember { mutableStateOf(SyncPairStore.list()) }
    var showAddFlow by remember { mutableStateOf(false) }
    var activityTick by remember { mutableStateOf(0) }
    var invites by remember { mutableStateOf(UniversalSyncInviteStore.pending()) }
    var respondingInvite by remember { mutableStateOf<UniversalSyncInvite?>(null) }
    var browsingInvite by remember { mutableStateOf<UniversalSyncInvite?>(null) }
    // task 188 — full remote browser (Add/Delete/Move/Share) for one of a paired Master's OWN Sync Pairs,
    // distinct from browsingInvite above which is the read-only Universal Sync grant browser.
    var browsingMasterPair by remember { mutableStateOf<Pair<PairedMaster, MasterSyncPair>?>(null) }
    val context = LocalContext.current

    // What each paired Master (Mac/PC) is ITSELF syncing — read-only, so the phone shows folders synced
    // from every paired device, not only the pairs it created itself. null = still loading that master,
    // Err = unreachable right now (offline), Ok(emptyList()) = reachable but nothing set up there.
    var masterPairs by remember { mutableStateOf<Map<String, ApiResult<List<MasterSyncPair>>>>(emptyMap()) }
    LaunchedEffect(Unit) {
        Prefs.pairedMasters.forEach { master ->
            launch {
                val result = MasterApi.masterSyncPairs(master.host, master.token)
                masterPairs = masterPairs + (master.id to result)
            }
        }
    }

    // Universal Sync's host->phone pull otherwise only runs on WorkManager's 15-minute floor — a user who
    // opens this exact screen to check "did it arrive yet" shouldn't have to wait that long. Opening the
    // Sync tab is the natural moment to force a fresh pull.
    LaunchedEffect(Unit) { SyncPushScheduler.runOnce(context) }

    fun refresh() {
        pairs = SyncPairStore.list()
        invites = UniversalSyncInviteStore.pending()
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

    // read-only invites never set respondingInvite (see the Accept button below) — by the time this
    // branch is reached, invite.permission is always "read-write" or "write-only".
    val invite = respondingInvite
    if (invite != null) {
        LocalFolderPicker(
            onCancel = { respondingInvite = null },
            onPicked = { localPath ->
                SyncPairStore.add(
                    SyncPair(
                        id = "${System.currentTimeMillis()}-${(0..9999).random()}",
                        name = invite.name,
                        localPath = localPath,
                        providerId = "",
                        providerLabel = "Universal Sync",
                        remoteFolderId = invite.hostFolderId,
                        remoteFolderName = invite.name,
                        status = "active",
                        createdAt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.getDefault()).format(Date()),
                        masterId = invite.masterId,
                        targetKind = "device",
                        universalSyncId = invite.universalSyncId,
                    ),
                )
                UniversalSyncInviteStore.updateStatus(invite.id, "accepted")
                respondingInvite = null
                refresh()
                SyncPushScheduler.runOnce(context)
                SyncPushScheduler.start(context)
            },
        )
        return
    }

    browsingInvite?.let { b ->
        UniversalSyncBrowseDialog(invite = b, onDismiss = { browsingInvite = null })
    }

    browsingMasterPair?.let { (master, pair) ->
        MasterSyncPairBrowseDialog(master = master, pair = pair, onDismiss = { browsingMasterPair = null })
    }

    ScreenScaffold("Sync", onOpenDrawer) {
        ScreenHeader("Sync", "Phone folders that automatically push to a cloud folder via your Master Device.")

        if (invites.isNotEmpty()) {
            Text("UNIVERSAL SYNC INVITES", style = MaterialTheme.typography.labelSmall, color = LocalAllieMinateColors.current.onSurfaceTertiary)
            invites.forEach { inv ->
                GlassCard {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(inv.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        Text(
                            "${inv.hostDeviceName} wants to share this folder (${inv.permission.replace('-', ' ')})",
                            style = MaterialTheme.typography.bodySmall,
                            color = LocalAllieMinateColors.current.onSurfaceSecondary,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(onClick = {
                                UniversalSyncInviteStore.updateStatus(inv.id, "declined")
                                refresh()
                            }) {
                                Icon(Icons.Filled.Close, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                                Text(" Decline", color = MaterialTheme.colorScheme.error)
                            }
                            TextButton(onClick = {
                                if (inv.permission == "read-only") {
                                    // Nothing to push — Android's sync engine is push-only, so a read-only
                                    // grant has no auto-sync story here yet. Accept it and drop straight
                                    // into a browse view instead of pretending to create a live sync pair
                                    // that would never receive anything.
                                    UniversalSyncInviteStore.updateStatus(inv.id, "accepted")
                                    browsingInvite = inv
                                    refresh()
                                } else {
                                    respondingInvite = inv
                                }
                            }) {
                                Icon(Icons.Filled.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                                Text(" Accept")
                            }
                        }
                    }
                }
            }
        }

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

        if (Prefs.pairedMasters.isNotEmpty()) {
            Text("SYNCED FROM YOUR DEVICES", style = MaterialTheme.typography.labelSmall, color = LocalAllieMinateColors.current.onSurfaceTertiary)
            Prefs.pairedMasters.forEach { master ->
                MasterSyncPairsSection(
                    master = master,
                    result = masterPairs[master.id],
                    onOpenPair = { pair -> browsingMasterPair = master to pair },
                )
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
private fun MasterSyncPairsSection(master: PairedMaster, result: ApiResult<List<MasterSyncPair>>?, onOpenPair: (MasterSyncPair) -> Unit) {
    val colors = LocalAllieMinateColors.current

    GlassCard {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(Icons.Filled.Computer, contentDescription = null, tint = colors.onSurfaceSecondary)
                Text(master.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
            }

            when (result) {
                null -> Text("Loading…", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceTertiary)
                is ApiResult.Err -> Text(
                    "${master.name} is offline right now",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.onSurfaceTertiary,
                )
                is ApiResult.Ok -> if (result.value.isEmpty()) {
                    Text("Nothing syncing on ${master.name} yet", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceTertiary)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        result.value.forEach { pair ->
                            Column(
                                verticalArrangement = Arrangement.spacedBy(2.dp),
                                modifier = Modifier.fillMaxWidth().clickable { onOpenPair(pair) },
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(pair.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                                    Text(
                                        if (pair.paused || pair.status == "paused") "Paused" else "Active",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = if (pair.paused || pair.status == "paused") colors.onSurfaceTertiary else colors.online,
                                    )
                                    Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = colors.onSurfaceTertiary, modifier = Modifier.size(18.dp))
                                }
                                Text(
                                    "${pair.localPath} → ${if (pair.targetKind == "device") "paired device" else pair.remotePath.ifBlank { "cloud" }}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.onSurfaceSecondary,
                                )
                                if (pair.totalCount > 0) {
                                    Text(
                                        "${pair.syncedCount}/${pair.totalCount} synced",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = colors.onSurfaceTertiary,
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

// Same top-level, dotfile/.tmp-excluded scope SyncPushWorker itself pushes from — a count that included
// files the worker would never touch (recursion, ignored names) would just be confusing.
private fun isSyncIgnored(name: String) = name.startsWith(".") || name in setOf("Thumbs.db", "desktop.ini") || name.endsWith(".tmp")

private fun countEligibleFiles(localPath: String): Int {
    val dir = java.io.File(localPath)
    return dir.listFiles { f -> f.isFile && !isSyncIgnored(f.name) }?.size ?: 0
}

private fun openInFileManager(context: android.content.Context, localPath: String) {
    val dir = java.io.File(localPath)
    val uri = runCatching {
        androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", dir)
    }.getOrNull()
    if (uri == null) {
        Toast.makeText(context, "Couldn't open that folder", Toast.LENGTH_SHORT).show()
        return
    }
    // "resource/folder" isn't a real registered MIME type — essentially no installed file manager declares
    // an intent-filter for it, which is why every attempt failed with "no app found". Google's Files app,
    // stock AOSP Files, and most third-party managers DO register against the DocumentsContract directory
    // MIME instead. Try that first, then fall back to explicitly launching known file-manager packages by
    // Uri (bypassing MIME matching entirely) before finally giving up.
    fun tryIntent(mime: String): Boolean {
        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mime)
            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return runCatching { context.startActivity(intent) }.isSuccess
    }
    fun tryPackage(pkg: String): Boolean {
        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "*/*")
            setPackage(pkg)
            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return runCatching { context.startActivity(intent) }.isSuccess
    }
    val opened = tryIntent("vnd.android.document/directory")
        || tryIntent("resource/folder")
        || tryPackage("com.google.android.apps.nbu.files") // Files by Google
        || tryPackage("com.android.documentsui") // stock AOSP Files
        || tryPackage("com.sec.android.app.myfiles") // Samsung My Files
    if (!opened) Toast.makeText(context, "No file manager app found to open that folder", Toast.LENGTH_SHORT).show()
}

@Composable
private fun SyncPairCard(pair: SyncPair, onChanged: () -> Unit) {
    val colors = LocalAllieMinateColors.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val paused = pair.status == "paused"
    val isUniversalSync = pair.universalSyncId != null
    var showDeleteConfirm by remember { mutableStateOf(false) }
    // SyncFileStateStore's on-disk state changes in the background (a WorkManager push/pull tick can land
    // minutes after this card first composed) with nothing in Compose's own state to signal it — remember()
    // keyed only on pair.id/localPath would freeze the very first read forever. A slow local tick is enough
    // to notice; this reads a SharedPreferences file, not a network call, so 3s is cheap.
    var tick by remember { mutableStateOf(0) }
    LaunchedEffect(pair.id) {
        while (true) {
            delay(3000)
            tick++
        }
    }
    val totalFiles = remember(pair.localPath, tick) { countEligibleFiles(pair.localPath) }
    val syncedFiles = remember(pair.id, tick) {
        SyncFileStateStore.load(pair.id).values.count { it.status == "synced" }
    }

    GlassCard(
        modifier = if (isUniversalSync) Modifier.clickable { openInFileManager(context, pair.localPath) } else Modifier,
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Filled.Sync, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(pair.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                        if (isUniversalSync) {
                            Text(
                                "UNIVERSAL SYNC",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            )
                        }
                    }
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
                if (totalFiles > 0) {
                    Text(
                        "· Synced Files: $syncedFiles/$totalFiles",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceTertiary,
                    )
                }
            }
            if (isUniversalSync) {
                Text("Tap to open this folder in your file manager", style = MaterialTheme.typography.labelSmall, color = colors.onSurfaceTertiary)
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
                TextButton(onClick = { showDeleteConfirm = true }) {
                    Icon(Icons.Filled.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Text(" Delete", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }

    if (showDeleteConfirm) {
        DeleteSyncPairConfirmDialog(
            name = pair.name,
            onDismiss = { showDeleteConfirm = false },
            onConfirmed = {
                showDeleteConfirm = false
                // Deleting a pair used to just forget it locally — every file it ever pushed stayed in
                // the cloud folder forever with nothing left on the phone to say which files were its.
                // Read the synced-file list (and cascade-trash them on the Master) BEFORE clearing that
                // state — SyncPairStore.remove() wipes SyncFileStateStore for this pair as its last step.
                val master = Prefs.masterById(pair.masterId) ?: Prefs.primaryMaster
                val host = master?.host
                val token = master?.token
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
            },
        )
    }
}

// Same destructive-action gate as the Mac/Windows app: a plain confirmation was too easy to blow through
// by reflex, so Yes triggers a real device-auth prompt (fingerprint/face/PIN/pattern — whatever the phone
// has set up) before the delete actually happens. If the phone has no screen lock at all, there's nothing
// to authenticate against — DeviceAuth.isAvailable() reports that and the plain confirmation stands alone.
@Composable
private fun DeleteSyncPairConfirmDialog(name: String, onDismiss: () -> Unit, onConfirmed: () -> Unit) {
    val context = LocalContext.current
    var authError by remember { mutableStateOf<String?>(null) }

    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Delete Sync Pair") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Are you sure you want to delete \"$name\" from AllieMinate?")
                authError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (!DeviceAuth.isAvailable(context)) { onConfirmed(); return@TextButton }
                DeviceAuth.prompt(
                    context = context,
                    title = "Confirm Delete",
                    subtitle = "Confirm deleting \"$name\"",
                    onSuccess = onConfirmed,
                    onError = { authError = it },
                )
            }) { Text("Yes") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("No") } },
    )
}

// ---------------------------------------------------------------------------------------------
// Universal Sync — read-only browse. Android's sync engine is push-only (no auto-pull), so a read-only
// grant can't be turned into a live Sync Pair the way read-write/write-only can; this is the honest
// fallback — list what's in the host's shared folder right now and let the user pull files on demand.
// ---------------------------------------------------------------------------------------------
@Composable
private fun UniversalSyncBrowseDialog(invite: UniversalSyncInvite, onDismiss: () -> Unit) {
    val master = remember(invite.masterId) { Prefs.masterById(invite.masterId) }
    var files by remember { mutableStateOf<List<RemoteFile>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    LaunchedEffect(invite.id) {
        if (master == null) {
            error = "\"${invite.hostDeviceName}\" is no longer paired"
            return@LaunchedEffect
        }
        when (val r = MasterApi.localFolderFiles(master.host, master.token, invite.hostFolderId)) {
            is ApiResult.Ok -> files = r.value
            is ApiResult.Err -> error = r.message
        }
    }

    PickerScaffold(title = invite.name, subtitle = "Shared read-only by ${invite.hostDeviceName}", onCancel = onDismiss) {
        when {
            error != null -> EmptyStateCard(Icons.Filled.Folder, error!!)
            files == null -> CircularProgressIndicator()
            files!!.isEmpty() -> EmptyStateCard(Icons.Filled.Folder, "Nothing in this folder yet.")
            else -> files!!.forEach { file ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(LocalAllieMinateColors.current.surfaceStrong)
                        .padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(Icons.Filled.InsertDriveFile, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text(file.path, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    IconButton(onClick = {
                        val m = master ?: return@IconButton
                        scope.launch {
                            when (val r = MasterApi.downloadLocalFolderFile(m.host, m.token, invite.hostFolderId, file.path)) {
                                is ApiResult.Ok -> {
                                    val mime = Downloads.guessMimeType(file.path, file.mimeType)
                                    val saved = Downloads.save(context, file.path, mime, r.value)
                                    android.widget.Toast.makeText(
                                        context,
                                        if (saved != null) "Saved \"${file.path}\" to Downloads" else "Couldn't save \"${file.path}\"",
                                        android.widget.Toast.LENGTH_SHORT,
                                    ).show()
                                }
                                is ApiResult.Err -> android.widget.Toast.makeText(context, r.message, android.widget.Toast.LENGTH_SHORT).show()
                            }
                        }
                    }) {
                        Icon(Icons.Filled.Download, contentDescription = "Download")
                    }
                }
            }
        }
    }
}

private fun fileDisplayName(context: android.content.Context, uri: android.net.Uri): String {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0) return cursor.getString(idx)
        }
    }
    return uri.lastPathSegment ?: "file"
}

// task 188 — full remote browser (Add/Delete/Move/Share) for one of a paired Master's OWN Sync Pairs.
// Distinct from UniversalSyncBrowseDialog above (which is read-only, for a Universal Sync grant this
// phone doesn't own) — a Sync Pair the Master itself created is fully manageable from either end.
@Composable
private fun MasterSyncPairBrowseDialog(master: PairedMaster, pair: MasterSyncPair, onDismiss: () -> Unit) {
    var files by remember { mutableStateOf<List<RemoteFile>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var refreshTick by remember { mutableStateOf(0) }
    var busyKey by remember { mutableStateOf<String?>(null) }
    var moveTarget by remember { mutableStateOf<RemoteFile?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    LaunchedEffect(pair.id, refreshTick) {
        when (val r = MasterApi.syncPairFiles(master.host, master.token, pair.id)) {
            is ApiResult.Ok -> { files = r.value; error = null }
            is ApiResult.Err -> error = r.message
        }
    }

    fun toast(msg: String) = Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()

    val addLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val name = fileDisplayName(context, uri)
        busyKey = "__add__"
        scope.launch {
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            val result = if (bytes != null) MasterApi.uploadSyncPairFile(master.host, master.token, pair.id, name, bytes) else ApiResult.Err("couldn't read that file")
            busyKey = null
            when (result) {
                is ApiResult.Ok -> { toast("Added \"$name\""); refreshTick++ }
                is ApiResult.Err -> toast(result.message)
            }
        }
    }

    if (moveTarget != null) {
        val target = moveTarget!!
        CreateFolderDialog(
            creating = { subPath, onDone ->
                scope.launch {
                    when (val r = MasterApi.moveSyncPairFile(master.host, master.token, pair.id, target.path, subPath)) {
                        is ApiResult.Ok -> { toast("Moved \"${target.displayName}\""); moveTarget = null; refreshTick++; onDone(null) }
                        is ApiResult.Err -> onDone(r.message)
                    }
                }
            },
            onDismiss = { moveTarget = null },
        )
    }

    PickerScaffold(title = pair.name, subtitle = "${pair.localPath} on ${master.name}", onCancel = onDismiss) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(LocalAllieMinateColors.current.surfaceStrong)
                .clickable(enabled = busyKey == null) { addLauncher.launch("*/*") }
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (busyKey == "__add__") CircularProgressIndicator(modifier = Modifier.size(20.dp)) else Icon(Icons.Filled.Add, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text("Add a file to this folder", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        }
        when {
            error != null -> EmptyStateCard(Icons.Filled.Folder, error!!)
            files == null -> CircularProgressIndicator()
            files!!.isEmpty() -> EmptyStateCard(Icons.Filled.Folder, "Nothing in this folder yet.")
            else -> files!!.forEach { file ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(LocalAllieMinateColors.current.surfaceStrong)
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(Icons.Filled.InsertDriveFile, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text(
                        file.path,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f).padding(vertical = 14.dp),
                    )
                    if (busyKey == file.path) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp).padding(end = 12.dp))
                    } else {
                        IconButton(onClick = {
                            busyKey = file.path
                            scope.launch {
                                when (val r = MasterApi.downloadSyncPairFile(master.host, master.token, pair.id, file.path)) {
                                    is ApiResult.Ok -> {
                                        val mime = Downloads.guessMimeType(file.path, file.mimeType)
                                        Downloads.save(context, file.displayName, mime, r.value)
                                        busyKey = null
                                        toast("Saved \"${file.displayName}\" to Downloads")
                                    }
                                    is ApiResult.Err -> { busyKey = null; toast(r.message) }
                                }
                            }
                        }) { Icon(Icons.Filled.Download, contentDescription = "Download") }
                        IconButton(onClick = {
                            busyKey = file.path
                            scope.launch {
                                when (val r = MasterApi.downloadSyncPairFile(master.host, master.token, pair.id, file.path)) {
                                    is ApiResult.Ok -> {
                                        val mime = Downloads.guessMimeType(file.path, file.mimeType)
                                        val cacheFile = java.io.File(context.cacheDir, file.displayName)
                                        cacheFile.writeBytes(r.value)
                                        val fileUri = androidx.core.content.FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", cacheFile)
                                        val shareIntent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                                            type = mime
                                            putExtra(android.content.Intent.EXTRA_STREAM, fileUri)
                                            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                        }
                                        busyKey = null
                                        context.startActivity(android.content.Intent.createChooser(shareIntent, "Share ${file.displayName}"))
                                    }
                                    is ApiResult.Err -> { busyKey = null; toast(r.message) }
                                }
                            }
                        }) { Icon(Icons.Filled.Share, contentDescription = "Share") }
                        IconButton(onClick = { moveTarget = file }) { Icon(Icons.Filled.DriveFileMove, contentDescription = "Move") }
                        IconButton(onClick = {
                            busyKey = file.path
                            scope.launch {
                                when (val r = MasterApi.deleteSyncPairFile(master.host, master.token, pair.id, file.path)) {
                                    is ApiResult.Ok -> { busyKey = null; toast("Deleted \"${file.displayName}\""); refreshTick++ }
                                    is ApiResult.Err -> { busyKey = null; toast(r.message) }
                                }
                            }
                        }) { Icon(Icons.Filled.Delete, contentDescription = "Delete", tint = MaterialTheme.colorScheme.error) }
                    }
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
    // new Sync Pairs are created against whichever PC was paired first — with more than one paired, the
    // others' clouds aren't reachable from this picker yet (no cross-PC cloud aggregation UI exists).
    val host = Prefs.primaryMaster?.host
    val token = Prefs.primaryMaster?.token
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
    val host = Prefs.primaryMaster?.host
    val token = Prefs.primaryMaster?.token
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
                        masterId = Prefs.primaryMaster?.id,
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
