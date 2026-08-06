package com.alliminate.android.service

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import com.alliminate.android.data.Downloads
import com.alliminate.android.data.LocalManifest
import com.alliminate.android.data.Prefs
import com.alliminate.android.data.ReceivedFile
import com.alliminate.android.data.SyncPairStore
import com.alliminate.android.notifications.TransferNotifications
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject

const val LOCAL_SERVER_PORT = 4311
private const val MAX_MEDIA_ROWS = 500

private val DOCUMENT_EXTENSIONS = setOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "rtf")
private val ARCHIVE_EXTENSIONS = setOf("zip", "rar", "7z", "tar", "gz")

// directories not worth walking into: other apps' sandboxed data (unreadable anyway even with All Files
// Access on modern Android), and this app's own cache/received-files area (already covered by "received").
private val WALK_SKIP_DIR_NAMES = setOf("Android", ".thumbnails", ".trashed")

/** Sidebar categories for browsing a phone's real storage from the Master Device, matching what the
 * Devices > phone browser shows. Images/Videos/Audio are complete, real MediaStore collections. Documents
 * and Archives walk the real filesystem directly (requires MANAGE_EXTERNAL_STORAGE — the user opted into
 * this after being shown the tradeoff; MediaStore.Files can't see non-media files other apps created
 * without it either, so a real walk is the only way to get real coverage). */
private data class MediaCategory(
    val id: String,
    val label: String,
    val contentUri: Uri?,
    val selection: String?,
    val selectionArgs: Array<String>?,
    val fallbackMime: String,
    /** null = no extra runtime permission needed for this collection. */
    val permission: String? = null,
    val requiresAllFilesAccess: Boolean = false,
    val walkExtensions: Set<String>? = null,
)

private val MEDIA_CATEGORIES = listOf(
    MediaCategory(
        "images", "Images", MediaStore.Images.Media.EXTERNAL_CONTENT_URI, null, null, "image/*",
        permission = if (android.os.Build.VERSION.SDK_INT >= 33) android.Manifest.permission.READ_MEDIA_IMAGES else android.Manifest.permission.READ_EXTERNAL_STORAGE,
    ),
    MediaCategory(
        "videos", "Videos", MediaStore.Video.Media.EXTERNAL_CONTENT_URI, null, null, "video/*",
        permission = if (android.os.Build.VERSION.SDK_INT >= 33) android.Manifest.permission.READ_MEDIA_VIDEO else android.Manifest.permission.READ_EXTERNAL_STORAGE,
    ),
    MediaCategory(
        "audio", "Audio", MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, null, null, "audio/*",
        permission = if (android.os.Build.VERSION.SDK_INT >= 33) android.Manifest.permission.READ_MEDIA_AUDIO else android.Manifest.permission.READ_EXTERNAL_STORAGE,
    ),
    MediaCategory(
        "documents", "Documents", null, null, null, "application/octet-stream",
        requiresAllFilesAccess = true, walkExtensions = DOCUMENT_EXTENSIONS,
    ),
    MediaCategory(
        "archives", "Archives", null, null, null, "application/octet-stream",
        requiresAllFilesAccess = true, walkExtensions = ARCHIVE_EXTENSIONS,
    ),
)

private const val WALK_CACHE_TTL_MS = 20_000L
private val walkCache = HashMap<Set<String>, Pair<Long, List<java.io.File>>>()

/** Bounded recursive walk of external storage for a real, non-media file category — depth-limited and
 * capped at MAX_MEDIA_ROWS so a huge phone doesn't turn one request into a multi-minute scan. Short-TTL
 * cached per extension set: the Master Device hits this on every tray "recent files" glance and every
 * RemoteBrowser category open, and a fresh recursive walk each time was the main reason Documents/Archives
 * felt slow to load — 20s of staleness is an easy trade for not re-walking the whole phone that often. */
private fun walkExternalStorage(extensions: Set<String>): List<java.io.File> {
    val cached = walkCache[extensions]
    val now = System.currentTimeMillis()
    if (cached != null && now - cached.first < WALK_CACHE_TTL_MS) return cached.second

    val root = android.os.Environment.getExternalStorageDirectory()
    val found = mutableListOf<java.io.File>()
    val stack = ArrayDeque<Pair<java.io.File, Int>>()
    stack.addLast(root to 0)
    val maxDepth = 8

    while (stack.isNotEmpty() && found.size < MAX_MEDIA_ROWS) {
        val (dir, depth) = stack.removeLast()
        if (depth > maxDepth || dir.name in WALK_SKIP_DIR_NAMES) continue
        val children = runCatching { dir.listFiles() }.getOrNull() ?: continue
        for (child in children) {
            if (found.size >= MAX_MEDIA_ROWS) break
            if (child.isDirectory) {
                stack.addLast(child to depth + 1)
            } else if (child.extension.lowercase() in extensions) {
                found.add(child)
            }
        }
    }
    val result = found.sortedByDescending { it.lastModified() }
    walkCache[extensions] = now to result
    return result
}

/** Speaks the same three routes the desktop backend already exposes for LAN device browsing
 * (GET /status returning `folders`, GET /folders/:id/files, GET /folders/:id/download, POST
 * /folders/:id/upload) — the existing desktop DevicesView "Browse Files" and tray "Share to Device"
 * flows call these exact routes already, so they work against a phone target with zero desktop changes.
 * `received` stays scoped to files AllieMinate itself was directly shared (see LocalManifest); the
 * Images/Videos/Audio/Documents/Archives categories below browse the phone's real MediaStore-visible
 * storage instead. */
class LocalHttpServer(private val context: Context) : NanoHTTPD(LOCAL_SERVER_PORT) {

    private fun unauthorized() = newFixedLengthResponse(Response.Status.UNAUTHORIZED, "application/json", """{"error":"unauthorized"}""")
    private fun notFound() = newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", """{"error":"not found"}""")
    private fun badRequest(msg: String) = newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json", """{"error":"$msg"}""")
    private fun json(body: JSONObject) = newFixedLengthResponse(Response.Status.OK, "application/json", body.toString())

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri
        // /nearby/request* is reachable by ANY sender on the LAN, paired or not — that's the whole point
        // of Nearby Share (a device discovered via UDP broadcast has no pre-shared token). Consent lives in
        // the accept/decline notification itself, not in a Bearer token check.
        var authenticatedMaster: com.alliminate.android.data.PairedMaster? = null
        if (!uri.startsWith("/nearby/request")) {
            val auth = session.headers["authorization"]?.removePrefix("Bearer ")
            authenticatedMaster = Prefs.pairedMasters.firstOrNull { it.token == auth } ?: return unauthorized()
        }

        return when {
            session.method == Method.GET && uri == "/status" -> handleStatus()
            session.method == Method.GET && uri == "/sync-pairs" -> handleSyncPairs()
            session.method == Method.GET && uri.startsWith("/sync-pairs/") && uri.endsWith("/files") -> handleSyncPairFiles(uri)
            session.method == Method.GET && uri.startsWith("/sync-pairs/") && uri.endsWith("/download") -> handleSyncPairDownload(session, uri)
            session.method == Method.GET && uri == "/folders/received/files" -> handleReceivedFiles()
            session.method == Method.GET && uri.startsWith("/folders/") && uri.endsWith("/files") -> handleMediaFiles(uri)
            session.method == Method.GET && uri.startsWith("/folders/") && uri.endsWith("/download") -> handleDownload(session, uri)
            session.method == Method.GET && uri.startsWith("/folders/") && uri.endsWith("/thumbnail") -> handleThumbnail(session, uri)
            session.method == Method.DELETE && uri.startsWith("/folders/") && uri.endsWith("/file") -> handleDeleteMediaFile(session, uri)
            session.method == Method.PATCH && uri.startsWith("/folders/") && uri.endsWith("/file") -> handleRenameMediaFile(session, uri)
            session.method == Method.POST && uri == "/folders/received/upload" -> handleUpload(session)
            session.method == Method.POST && uri == "/nearby/request" -> handleNearbyRequest(session)
            session.method == Method.GET && uri.startsWith("/nearby/request/") && uri.endsWith("/status") -> handleNearbyStatus(uri)
            session.method == Method.POST && uri.startsWith("/nearby/request/") && uri.endsWith("/upload") -> handleNearbyUpload(session, uri)
            session.method == Method.POST && uri == "/continuity" -> handleContinuity(session, authenticatedMaster!!)
            session.method == Method.POST && uri == "/unlock/request" -> handleUnlockRequest(session)
            session.method == Method.GET && uri.startsWith("/unlock/request/") && uri.endsWith("/status") -> handleUnlockStatus(uri)
            session.method == Method.POST && uri == "/unpair" -> handleUnpair(authenticatedMaster!!)
            else -> notFound()
        }
    }

    private fun readRequestBody(session: IHTTPSession): ByteArray? {
        val lengthHeader = session.headers["content-length"]?.toIntOrNull() ?: return null
        val body = ByteArray(lengthHeader)
        var read = 0
        while (read < lengthHeader) {
            val n = session.inputStream.read(body, read, lengthHeader - read)
            if (n < 0) break
            read += n
        }
        return body
    }

    private fun handleNearbyRequest(session: IHTTPSession): Response {
        val bytes = readRequestBody(session) ?: return badRequest("missing content-length")
        val body = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull() ?: return badRequest("invalid body")
        val fromName = body.optString("fromName").takeIf { it.isNotBlank() } ?: return badRequest("missing fromName")
        val fileName = body.optString("fileName").takeIf { it.isNotBlank() } ?: return badRequest("missing fileName")
        val fileSize = body.optLong("fileSize", 0)

        val request = NearbyShareRegistry.create(fromName, fileName, fileSize)
        TransferNotifications.showNearbyRequest(context, request.id, fromName, fileName)
        return json(JSONObject().apply { put("ok", true); put("requestId", request.id) })
    }

    private fun handleNearbyStatus(uri: String): Response {
        val id = uri.removePrefix("/nearby/request/").removeSuffix("/status")
        val request = NearbyShareRegistry.get(id) ?: return notFound()
        return json(JSONObject().apply { put("status", request.status.name.lowercase()) })
    }

    private fun handleNearbyUpload(session: IHTTPSession, uri: String): Response {
        val id = uri.removePrefix("/nearby/request/").removeSuffix("/upload")
        val request = NearbyShareRegistry.get(id) ?: return notFound()
        if (request.status != NearbyRequestStatus.ACCEPTED) {
            return newFixedLengthResponse(Response.Status.FORBIDDEN, "application/json", """{"error":"transfer not accepted"}""")
        }
        val bytes = readRequestBody(session) ?: return badRequest("missing content-length")

        val mime = Downloads.guessMimeType(request.fileName, null)
        val savedUri = Downloads.save(context, request.fileName, mime, bytes)
            ?: return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json", """{"error":"couldn't save file"}""")
        LocalManifest.add(ReceivedFile(name = request.fileName, uri = savedUri.toString(), size = bytes.size.toLong(), mimeType = mime, addedAt = System.currentTimeMillis()))
        TransferNotifications.showReceived(context, request.fileName, savedUri, mime)
        return json(JSONObject().apply { put("ok", true) })
    }

    // Continuity Handoff — the paired Master Device just opened a file and pushed a "now viewing X"
    // presence signal here (see backend's continuity.ts). This route is Bearer-authenticated like every
    // other paired route (unlike /nearby/request, there's no unpaired-consent story to work around here).
    private fun handleContinuity(session: IHTTPSession, master: com.alliminate.android.data.PairedMaster): Response {
        val bytes = readRequestBody(session) ?: return badRequest("missing content-length")
        val body = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull() ?: return badRequest("invalid body")
        val fromName = body.optString("fromName").takeIf { it.isNotBlank() } ?: return badRequest("missing fromName")
        val fileName = body.optString("fileName").takeIf { it.isNotBlank() } ?: return badRequest("missing fileName")
        val providerId = body.optString("providerId").takeIf { it.isNotBlank() } ?: return badRequest("missing providerId")
        val key = body.optString("key").takeIf { it.isNotBlank() } ?: return badRequest("missing key")
        val mimeType = body.optString("mimeType").takeIf { it.isNotBlank() }
        TransferNotifications.showContinuity(context, fromName, fileName, providerId, key, mimeType, master.id)
        return json(JSONObject().apply { put("ok", true) })
    }

    // Phase 3: Phone as Remote Unlock/Approve — receiver side. This route requires the standard Bearer
    // auth (it's deliberately NOT in the /nearby/request-style public exemption above): only a Mac already
    // paired with this phone can even ask, since approving an unlock is a much bigger deal than accepting
    // a file share. This only ever gates the Mac's own in-app App Lock, never anything OS-level.
    private fun handleUnlockRequest(session: IHTTPSession): Response {
        val bytes = readRequestBody(session) ?: return badRequest("missing content-length")
        val body = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull() ?: return badRequest("invalid body")
        val requestId = body.optString("requestId").takeIf { it.isNotBlank() } ?: return badRequest("missing requestId")
        val fromName = body.optString("fromName").takeIf { it.isNotBlank() } ?: return badRequest("missing fromName")
        UnlockApprovalRegistry.create(requestId, fromName)
        TransferNotifications.showUnlockRequest(context, requestId, fromName)
        return json(JSONObject().apply { put("ok", true) })
    }

    private fun handleUnlockStatus(uri: String): Response {
        val id = uri.removePrefix("/unlock/request/").removeSuffix("/status")
        val request = UnlockApprovalRegistry.get(id) ?: return notFound()
        return json(JSONObject().apply { put("status", request.status.name.lowercase()) })
    }

    // The Master just removed us from its own paired-devices list (devices.ts's DELETE /devices/:id) and
    // is telling us so — without this, unpairing from the Mac side only ever cleared ITS OWN record; this
    // phone kept its token and just sat there showing the Mac as "Offline" forever instead of actually
    // unpaired. The Bearer token check in serve() above already proves this call came from a master we
    // currently trust, and now identifies WHICH one — with up to 5 paired, only that one entry is dropped,
    // not every pairing this phone has. The foreground service is left running; every feature that depends
    // on being paired already gates on Prefs.isPaired, so an unpaired-but-still-running service is harmless
    // (same as right after a fresh install, before ever pairing).
    private fun handleUnpair(master: com.alliminate.android.data.PairedMaster): Response {
        Prefs.clearPairing(master.id)
        return json(JSONObject().apply { put("ok", true) })
    }

    private fun handleStatus(): Response {
        val folders = JSONArray().apply {
            put(JSONObject().apply { put("id", "received"); put("name", "Received on Phone"); put("provider", "android"); put("remotePrefix", "received") })
            MEDIA_CATEGORIES.forEach { cat ->
                put(JSONObject().apply { put("id", cat.id); put("name", cat.label); put("provider", "android"); put("remotePrefix", cat.id) })
            }
        }
        return json(JSONObject().apply {
            put("ok", true)
            put("folders", folders)
            // read by the Master Device's own /devices polling (via its testConnection call, same request
            // already used for the online check) to decide whether this phone shows up as a Nearby Share
            // target there — no extra request needed on either side.
            put("nearbyShareEnabled", Prefs.nearbyShareEnabled.value)
        })
    }

    private fun handleReceivedFiles(): Response {
        val arr = JSONArray()
        LocalManifest.list().forEach { f ->
            arr.put(
                JSONObject().apply {
                    put("path", f.name)
                    put("size", f.size)
                    put("hash", "")
                    put("modifiedAt", java.time.Instant.ofEpochMilli(f.addedAt).toString())
                    put("mimeType", f.mimeType)
                },
            )
        }
        return json(JSONObject().apply { put("files", arr) })
    }

    /** Images/Videos/Audio/Documents/Archives — the Finder-style category sidebar on the Master Device's
     * Devices > phone browser. Images/Videos/Audio are full, real MediaStore collections (subject to the
     * matching runtime permission being granted in Settings). Documents/Archives are best-effort: without
     * MANAGE_EXTERNAL_STORAGE (deliberately not requested — see Settings' file-access explanation) Android's
     * scoped storage only exposes non-media files this app itself created plus MediaStore.Files entries
     * other apps have opted to share, so coverage there is real but partial, not the whole filesystem. */
    private fun handleMediaFiles(uri: String): Response {
        val id = uri.removePrefix("/folders/").removeSuffix("/files")
        val category = MEDIA_CATEGORIES.find { it.id == id } ?: return notFound()

        // don't silently return an empty list when it's actually a missing permission — that's exactly
        // the kind of "why is this empty" mystery the project has been burned by before (see the
        // /devices/:id/test diagnostic route added for the same reason on the desktop side).
        val permission = category.permission
        if (permission != null && context.checkSelfPermission(permission) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return json(JSONObject().apply {
                put("files", JSONArray())
                put("error", "${category.label} access isn't granted — enable it in AllieMinate's Settings on this phone")
            })
        }
        if (category.requiresAllFilesAccess && !android.os.Environment.isExternalStorageManager()) {
            return json(JSONObject().apply {
                put("files", JSONArray())
                put("error", "${category.label} access isn't granted — enable \"Documents & Archives Access\" in AllieMinate's Settings on this phone")
            })
        }

        if (category.walkExtensions != null) {
            val arr = JSONArray()
            val result = runCatching {
                walkExternalStorage(category.walkExtensions).forEach { file ->
                    arr.put(
                        JSONObject().apply {
                            put("path", "${Uri.encode(file.absolutePath)}/${file.name}")
                            put("size", file.length())
                            put("hash", "")
                            put("modifiedAt", java.time.Instant.ofEpochMilli(file.lastModified()).toString())
                            // plain java.io.File has no separate "creation time" API before API26's
                            // BasicFileAttributes — lastModified is what's uniformly available.
                            put("createdAt", java.time.Instant.ofEpochMilli(file.lastModified()).toString())
                            put("mimeType", category.fallbackMime)
                            put("devicePath", file.absolutePath)
                        },
                    )
                }
            }
            return json(
                JSONObject().apply {
                    put("files", arr)
                    result.exceptionOrNull()?.let { put("error", it.message ?: it.toString()) }
                },
            )
        }

        val arr = JSONArray()
        val queryResult = runCatching {
            // NOTE: LIMIT used to be appended straight into the sortOrder string — that's a common trick
            // on Android but it isn't universally accepted by every MediaProvider implementation (throws
            // "Invalid token LIMIT" on some collections/OS versions). Truncating in Kotlin after the fact
            // is slightly less efficient but portable everywhere.
            context.contentResolver.query(
                category.contentUri!!,
                arrayOf(
                    MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE,
                    MediaStore.MediaColumns.DATE_MODIFIED, MediaStore.MediaColumns.DATE_ADDED, MediaStore.MediaColumns.MIME_TYPE,
                    MediaStore.MediaColumns.DATA,
                ),
                category.selection,
                category.selectionArgs,
                "${MediaStore.MediaColumns.DATE_MODIFIED} DESC",
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
                val sizeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)
                val dateCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED)
                val addedCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_ADDED)
                val mimeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
                @Suppress("DEPRECATION") val dataCol = cursor.getColumnIndex(MediaStore.MediaColumns.DATA)
                var count = 0
                while (cursor.moveToNext() && count < MAX_MEDIA_ROWS) {
                    val displayName = cursor.getString(nameCol) ?: "file_${cursor.getLong(idCol)}"
                    arr.put(
                        JSONObject().apply {
                            put("path", "${cursor.getLong(idCol)}/$displayName")
                            put("size", cursor.getLong(sizeCol))
                            put("hash", "")
                            put("modifiedAt", java.time.Instant.ofEpochSecond(cursor.getLong(dateCol)).toString())
                            put("createdAt", java.time.Instant.ofEpochSecond(cursor.getLong(addedCol)).toString())
                            put("mimeType", cursor.getString(mimeCol) ?: category.fallbackMime)
                            if (dataCol >= 0) put("devicePath", cursor.getString(dataCol) ?: "")
                        },
                    )
                    count++
                }
            }
        }
        return json(
            JSONObject().apply {
                put("files", arr)
                queryResult.exceptionOrNull()?.let { put("error", it.message ?: it.toString()) }
            },
        )
    }

    /** Streams straight from a ContentResolver descriptor — a multi-GB video read into a ByteArray first
     * (the old approach) OOMs the same way the share-upload path used to; NanoHTTPD can write a response
     * straight off an InputStream, so there's no reason to buffer the whole file in memory here either. */
    private fun handleDownload(session: IHTTPSession, uri: String): Response {
        val folderId = uri.removePrefix("/folders/").removeSuffix("/download")
        val key = session.parms["key"] ?: return badRequest("missing key")

        val (stream, length) = when {
            folderId == "received" -> {
                val entry = LocalManifest.find(key) ?: return notFound()
                val s = runCatching { context.contentResolver.openInputStream(Uri.parse(entry.uri)) }.getOrNull() ?: return notFound()
                s to entry.size
            }
            MEDIA_CATEGORIES.any { it.id == folderId && it.walkExtensions != null } -> {
                val filePath = Uri.decode(key.substringBefore('/'))
                val file = java.io.File(filePath)
                if (!file.isFile) return notFound()
                java.io.FileInputStream(file) to file.length()
            }
            MEDIA_CATEGORIES.any { it.id == folderId } -> {
                val category = MEDIA_CATEGORIES.first { it.id == folderId }
                val id = key.substringBefore('/').toLongOrNull() ?: return badRequest("bad key")
                val itemUri = ContentUris.withAppendedId(category.contentUri!!, id)
                val pfd = runCatching { context.contentResolver.openAssetFileDescriptor(itemUri, "r") }.getOrNull() ?: return notFound()
                pfd.createInputStream() to pfd.length
            }
            else -> return notFound()
        }

        return if (length >= 0) {
            newFixedLengthResponse(Response.Status.OK, "application/octet-stream", stream, length)
        } else {
            newChunkedResponse(Response.Status.OK, "application/octet-stream", stream)
        }
    }

    // Same defaults SyncPushWorker.kt seeds — kept in sync deliberately so a folder synced from either
    // side treats the same files as noise. (Duplicated rather than shared since work/ and service/ are
    // separate small standalone functions here, not worth a shared module for four strings.)
    private val SYNC_IGNORED_NAMES = setOf(".DS_Store", ".git", "node_modules", ".localized")
    private fun isSyncIgnored(name: String) = name.startsWith(".") || name in SYNC_IGNORED_NAMES || name.endsWith(".tmp")

    /** Mac's Sync tab "Sync from Device" section — lists this phone's active Sync Pairs so the paired Mac
     * can browse what's in each one, same idea as the existing MEDIA_CATEGORIES folders but sourced from
     * SyncPairStore instead of MediaStore. */
    private fun handleSyncPairs(): Response {
        val arr = JSONArray()
        SyncPairStore.list().forEach { pair ->
            arr.put(
                JSONObject().apply {
                    put("id", pair.id)
                    put("name", pair.name)
                    put("providerId", pair.providerId)
                    put("providerLabel", pair.providerLabel)
                    put("remoteFolderId", pair.remoteFolderId ?: "")
                    put("remoteFolderName", pair.remoteFolderName)
                    put("status", pair.status)
                },
            )
        }
        return json(JSONObject().put("pairs", arr))
    }

    private fun handleSyncPairFiles(uri: String): Response {
        val pairId = uri.removePrefix("/sync-pairs/").removeSuffix("/files")
        val pair = SyncPairStore.get(pairId) ?: return notFound()
        val dir = java.io.File(pair.localPath)
        if (!dir.isDirectory) {
            return json(JSONObject().apply {
                put("files", JSONArray())
                put("error", "\"${pair.name}\" — folder no longer exists on this phone")
            })
        }

        val arr = JSONArray()
        (dir.listFiles { f -> f.isFile && !isSyncIgnored(f.name) } ?: emptyArray())
            .sortedByDescending { it.lastModified() }
            .forEach { file ->
                arr.put(
                    JSONObject().apply {
                        put("path", file.name)
                        put("size", file.length())
                        put("hash", "")
                        put("modifiedAt", java.time.Instant.ofEpochMilli(file.lastModified()).toString())
                        put("createdAt", java.time.Instant.ofEpochMilli(file.lastModified()).toString())
                        put("mimeType", android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "")
                    },
                )
            }
        return json(JSONObject().put("files", arr))
    }

    private fun handleSyncPairDownload(session: IHTTPSession, uri: String): Response {
        val pairId = uri.removePrefix("/sync-pairs/").removeSuffix("/download")
        val pair = SyncPairStore.get(pairId) ?: return notFound()
        val key = session.parms["key"] ?: return badRequest("missing key")
        // key is always just a bare filename (Phase 1 scope: top-level files only, no subfolder walk) —
        // still resolved against the pair's OWN folder and re-checked for containment rather than trusted
        // outright, the same caution the Mac backend's own /local/download route uses for its scan roots.
        val file = java.io.File(java.io.File(pair.localPath), key)
        if (!file.isFile || file.parentFile?.absolutePath != java.io.File(pair.localPath).absolutePath) return notFound()

        val stream = java.io.FileInputStream(file)
        return newFixedLengthResponse(Response.Status.OK, "application/octet-stream", stream, file.length())
    }

    /** Small JPEG preview for a grid card — real MediaStore-generated thumbnails (Android already keeps
     * these cached for its own Photos app), not a full-res download, so the Devices > phone Images/Videos
     * grid can look like the rest of AllieMinate's file grids instead of showing bare icons. */
    private fun handleThumbnail(session: IHTTPSession, uri: String): Response {
        val folderId = uri.removePrefix("/folders/").removeSuffix("/thumbnail")
        val category = MEDIA_CATEGORIES.find { it.id == folderId && it.contentUri != null } ?: return notFound()
        val key = session.parms["key"] ?: return badRequest("missing key")
        val id = key.substringBefore('/').toLongOrNull() ?: return badRequest("bad key")
        val itemUri = ContentUris.withAppendedId(category.contentUri!!, id)

        val bitmap = runCatching {
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                context.contentResolver.loadThumbnail(itemUri, android.util.Size(256, 256), null)
            } else {
                @Suppress("DEPRECATION")
                when (category.id) {
                    "images" -> MediaStore.Images.Thumbnails.getThumbnail(context.contentResolver, id, MediaStore.Images.Thumbnails.MINI_KIND, null)
                    "videos" -> MediaStore.Video.Thumbnails.getThumbnail(context.contentResolver, id, MediaStore.Video.Thumbnails.MINI_KIND, null)
                    else -> null
                }
            }
        }.getOrNull() ?: return notFound()

        val out = java.io.ByteArrayOutputStream()
        bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, out)
        val bytes = out.toByteArray()
        return newFixedLengthResponse(Response.Status.OK, "image/jpeg", java.io.ByteArrayInputStream(bytes), bytes.size.toLong())
    }

    /** Delete for a phone-hosted media file — works directly (no scoped-storage consent round-trip)
     * because this app holds MANAGE_EXTERNAL_STORAGE; without it, deleting a file this app didn't create
     * would need an Activity-based consent flow a headless HTTP handler can't do. Rename isn't exposed for
     * the same reason plus MediaStore's own display-name-uniqueness quirks — a real fix would need that
     * same consent-flow plumbing, scoped out for now rather than shipping something that half-works. */
    private fun handleDeleteMediaFile(session: IHTTPSession, uri: String): Response {
        val folderId = uri.removePrefix("/folders/").removeSuffix("/file")
        val key = session.parms["key"] ?: return badRequest("missing key")

        val ok = when {
            MEDIA_CATEGORIES.any { it.id == folderId && it.walkExtensions != null } -> {
                val filePath = Uri.decode(key.substringBefore('/'))
                runCatching { java.io.File(filePath).delete() }.getOrDefault(false)
            }
            MEDIA_CATEGORIES.any { it.id == folderId } -> {
                val category = MEDIA_CATEGORIES.first { it.id == folderId }
                val id = key.substringBefore('/').toLongOrNull() ?: return badRequest("bad key")
                val itemUri = ContentUris.withAppendedId(category.contentUri!!, id)
                runCatching { context.contentResolver.delete(itemUri, null, null) > 0 }.getOrDefault(false)
            }
            else -> false
        }
        return if (ok) json(JSONObject().apply { put("ok", true) }) else badRequest("couldn't delete file")
    }

    // MediaStore rename via ContentResolver.update() needs RecoverableSecurityException consent for files
    // this app doesn't own — bypassed entirely by MANAGE_EXTERNAL_STORAGE, which the Documents/Archives
    // walk already requires the user to have granted (see Settings' AllFilesAccessRow), so by the time this
    // route is reachable in practice the same broad permission already covers a plain rename too.
    private fun handleRenameMediaFile(session: IHTTPSession, uri: String): Response {
        val folderId = uri.removePrefix("/folders/").removeSuffix("/file")
        val key = session.parms["key"] ?: return badRequest("missing key")
        val newName = session.parms["newName"]?.takeIf { it.isNotBlank() } ?: return badRequest("missing newName")

        val ok = when {
            MEDIA_CATEGORIES.any { it.id == folderId && it.walkExtensions != null } -> {
                val filePath = Uri.decode(key.substringBefore('/'))
                val file = java.io.File(filePath)
                val target = java.io.File(file.parentFile, newName)
                runCatching { file.renameTo(target) }.getOrDefault(false)
            }
            MEDIA_CATEGORIES.any { it.id == folderId } -> {
                val category = MEDIA_CATEGORIES.first { it.id == folderId }
                val id = key.substringBefore('/').toLongOrNull() ?: return badRequest("bad key")
                val itemUri = ContentUris.withAppendedId(category.contentUri!!, id)
                val values = android.content.ContentValues().apply { put(MediaStore.MediaColumns.DISPLAY_NAME, newName) }
                runCatching { context.contentResolver.update(itemUri, values, null, null) > 0 }.getOrDefault(false)
            }
            else -> false
        }
        return if (ok) json(JSONObject().apply { put("ok", true) }) else badRequest("couldn't rename file")
    }

    private fun handleUpload(session: IHTTPSession): Response {
        val name = session.parms["name"] ?: return badRequest("missing name")
        val from = session.parms["from"]?.takeIf { it.isNotBlank() } ?: "your Master Device"
        val lengthHeader = session.headers["content-length"]?.toIntOrNull() ?: return badRequest("missing content-length")

        com.alliminate.android.notifications.IncomingTransferControl.cancelled.set(false)
        val body = ByteArray(lengthHeader)
        var read = 0
        var lastReportedPercent = -1
        while (read < lengthHeader) {
            if (com.alliminate.android.notifications.IncomingTransferControl.cancelled.get()) {
                TransferNotifications.showReceiveCancelled(context, name)
                return badRequest("transfer stopped")
            }
            val n = session.inputStream.read(body, read, lengthHeader - read)
            if (n < 0) break
            read += n
            val percent = if (lengthHeader > 0) (read * 100) / lengthHeader else 0
            if (percent != lastReportedPercent) {
                lastReportedPercent = percent
                TransferNotifications.showIncomingProgress(context, name, from, percent)
            }
        }
        val mime = Downloads.guessMimeType(name, null)
        val savedUri = Downloads.save(context, name, mime, body)
        if (savedUri == null) {
            TransferNotifications.showReceiveFailed(context, name)
            return badRequest("couldn't save file")
        }
        LocalManifest.add(ReceivedFile(name = name, uri = savedUri.toString(), size = body.size.toLong(), mimeType = mime, addedAt = System.currentTimeMillis()))
        TransferNotifications.showReceived(context, name, savedUri, mime)
        return json(JSONObject().apply { put("ok", true); put("key", name); put("size", body.size) })
    }
}
