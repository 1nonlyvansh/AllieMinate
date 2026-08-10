package com.alliminate.android.data

data class PairResult(
    val id: String,
    val name: String,
    val platform: String,
    val token: String,
)

data class AccountInfo(
    val accountId: String,
    val label: String,
    val provider: String,
)

data class RemoteFolder(
    val id: String,
    val name: String,
    val provider: String,
)

data class RemoteFile(
    val path: String,
    val size: Long,
    val modifiedAt: String,
    val mimeType: String?,
    val thumbnailUrl: String?,
) {
    val displayName: String get() = path.substringAfterLast('/')
}

// A real folder object in the account's own native tree (Drive/OneDrive object id, MEGA node id, etc —
// provider-specific, opaque to this app) — distinct from RemoteFolder above, which is a paired-device
// folder id used by the Auto-Sync/backup pickers, not a cloud account's own folder structure.
data class TreeFolderNode(
    val id: String,
    val name: String,
)

data class TreeResult(
    val folders: List<TreeFolderNode>,
    val files: List<RemoteFile>,
)

// Phase 4: Cross-Device Search result — mirrors the backend's SearchResult shape in search.ts exactly.
// providerId is set for a 'cloud' hit, deviceId+folderId for a 'device' hit (never both).
data class SearchResult(
    val source: String,
    val sourceLabel: String,
    val providerId: String?,
    val deviceId: String?,
    val folderId: String?,
    val path: String,
    val size: Long,
    val modifiedAt: String,
    val mimeType: String?,
) {
    val displayName: String get() = path.substringAfterLast('/')
}

// A Sync Pair that lives on a paired Master's OWN registry (created there, via that Mac/PC's Sync page or
// Universal Sync wizard) — read-only from the phone's side, just for visibility ("what is this Mac/PC
// actually syncing"). Distinct from SyncPair (data/SyncPair.kt), which is the phone's OWN push-only registry.
data class MasterSyncPair(
    val id: String,
    val name: String,
    val localPath: String,
    val targetKind: String, // "cloud" | "device"
    val remotePath: String,
    val direction: String,
    val status: String, // "active" | "paused"
    val paused: Boolean,
    val syncedCount: Int,
    val totalCount: Int,
)

// A subfolder inside a Master's local-folders shortcut (e.g. "Screenshots" inside Pictures) — `path` is
// relative to the shortcut's own root and already includes any parent segments, ready to pass straight
// back as the next browse call's ?path=.
data class RemoteFolderEntry(
    val name: String,
    val path: String,
)

data class LocalFolderListing(
    val folders: List<RemoteFolderEntry>,
    val files: List<RemoteFile>,
)

data class BatteryInfo(
    val percent: Int,
    val charging: Boolean,
)

sealed class ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>()
    data class Err(val message: String) : ApiResult<Nothing>()
}
