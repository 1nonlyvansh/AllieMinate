package com.alliminate.android.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

// Sync Engine (Android) — Phase 1/2. Mirrors the desktop app's SyncPair shape closely enough to stay
// conceptually the same feature, but scoped down for what this phone build actually does yet: one-way
// push only, a real cloud FOLDER as the target (not a flat key prefix — the only upload route this app has
// today, /providers/:id/upload, takes a folderId, unlike the desktop backend's own put(key) abstraction),
// top-level files only (no recursive subfolder walk yet).
data class SyncPair(
    val id: String,
    val name: String,
    val localPath: String,
    val providerId: String,
    val providerLabel: String,
    val remoteFolderId: String?,
    val remoteFolderName: String,
    val status: String, // "active" | "paused"
    val createdAt: String,
    // which paired PC this pair pushes to — nullable only for pairs created before multi-pairing existed;
    // SyncPushWorker falls back to Prefs.primaryMaster for those, which was the only master they could
    // possibly have been created against.
    val masterId: String?,
)

/** One tracked file's last-known-pushed state, keyed by filename within the pair's local folder — enough
 * to tell "already synced, unchanged" from "needs a push" without re-uploading everything every pass. */
data class SyncFileRecord(
    val size: Long,
    val modifiedAt: Long,
    val lastSyncedAt: Long,
    val status: String, // "synced" | "error"
    val lastError: String? = null,
)

data class SyncActivityEntry(
    val id: String,
    val pairId: String,
    val text: String,
    val isError: Boolean,
    val timestamp: Long,
)

/** JSON-backed registry, same SharedPreferences-string pattern as OfflineManifest — a handful of pairs at
 * most, no reason for anything heavier. */
object SyncPairStore {
    private const val FILE = "alliminate_sync_pairs"
    private const val KEY = "pairs"
    private lateinit var prefs: android.content.SharedPreferences

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    fun list(): List<SyncPair> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        val arr = JSONArray(raw)
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            SyncPair(
                id = o.getString("id"),
                name = o.getString("name"),
                localPath = o.getString("localPath"),
                providerId = o.getString("providerId"),
                providerLabel = o.getString("providerLabel"),
                remoteFolderId = o.optString("remoteFolderId").ifBlank { null },
                remoteFolderName = o.optString("remoteFolderName"),
                status = o.optString("status").ifBlank { "active" },
                createdAt = o.getString("createdAt"),
                masterId = o.optString("masterId").ifBlank { null },
            )
        }
    }

    fun get(id: String): SyncPair? = list().find { it.id == id }

    fun add(pair: SyncPair) {
        save(list() + pair)
    }

    fun update(id: String, transform: (SyncPair) -> SyncPair) {
        save(list().map { if (it.id == id) transform(it) else it })
    }

    fun remove(id: String) {
        save(list().filterNot { it.id == id })
        SyncFileStateStore.clear(id)
    }

    private fun save(pairs: List<SyncPair>) {
        val arr = JSONArray()
        pairs.forEach { p ->
            arr.put(
                JSONObject().apply {
                    put("id", p.id)
                    put("name", p.name)
                    put("localPath", p.localPath)
                    put("providerId", p.providerId)
                    put("providerLabel", p.providerLabel)
                    put("remoteFolderId", p.remoteFolderId ?: "")
                    put("remoteFolderName", p.remoteFolderName)
                    put("status", p.status)
                    put("createdAt", p.createdAt)
                    put("masterId", p.masterId ?: "")
                },
            )
        }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }
}

/** Per-pair file baseline, one SharedPreferences file per pair (keyed by pair id so pairs never collide
 * and deleting a pair can just drop its whole file rather than filtering a shared one). */
object SyncFileStateStore {
    private lateinit var appContext: Context

    fun init(context: Context) {
        appContext = context.applicationContext
    }

    private fun prefsFor(pairId: String) = appContext.getSharedPreferences("alliminate_sync_state_$pairId", Context.MODE_PRIVATE)

    fun load(pairId: String): Map<String, SyncFileRecord> {
        val raw = prefsFor(pairId).getString("files", null) ?: return emptyMap()
        val obj = JSONObject(raw)
        return obj.keys().asSequence().associateWith { key ->
            val r = obj.getJSONObject(key)
            SyncFileRecord(
                size = r.getLong("size"),
                modifiedAt = r.getLong("modifiedAt"),
                lastSyncedAt = r.getLong("lastSyncedAt"),
                status = r.optString("status").ifBlank { "synced" },
                lastError = r.optString("lastError").ifBlank { null },
            )
        }
    }

    fun save(pairId: String, state: Map<String, SyncFileRecord>) {
        val obj = JSONObject()
        state.forEach { (relPath, r) ->
            obj.put(
                relPath,
                JSONObject().apply {
                    put("size", r.size)
                    put("modifiedAt", r.modifiedAt)
                    put("lastSyncedAt", r.lastSyncedAt)
                    put("status", r.status)
                    put("lastError", r.lastError ?: "")
                },
            )
        }
        prefsFor(pairId).edit().putString("files", obj.toString()).apply()
    }

    fun clear(pairId: String) {
        prefsFor(pairId).edit().clear().apply()
    }
}

/** Recent sync events across every pair — capped so it never grows unbounded, purely informational. */
object SyncActivityStore {
    private const val FILE = "alliminate_sync_activity"
    private const val KEY = "entries"
    private const val MAX_ENTRIES = 100
    private lateinit var prefs: android.content.SharedPreferences

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    fun list(): List<SyncActivityEntry> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        val arr = JSONArray(raw)
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            SyncActivityEntry(
                id = o.getString("id"),
                pairId = o.getString("pairId"),
                text = o.getString("text"),
                isError = o.optBoolean("isError", false),
                timestamp = o.getLong("timestamp"),
            )
        }
    }

    // record() is a read-modify-write over a single SharedPreferences string (the whole entry list gets
    // read, prepended to, and rewritten every call) — called concurrently from every parallel upload
    // coroutine in SyncPushWorker (Semaphore(3)), so two calls landing on different threads at once can
    // each read the same "before" list and one's write clobbers the other's, silently dropping entries.
    // Same race class stateByPair was hardened against with ConcurrentHashMap; this sibling store wasn't.
    @Synchronized
    fun record(pairId: String, text: String, isError: Boolean = false) {
        val entry = SyncActivityEntry(
            id = "${System.currentTimeMillis()}-${(0..9999).random()}",
            pairId = pairId,
            text = text,
            isError = isError,
            timestamp = System.currentTimeMillis(),
        )
        val next = (listOf(entry) + list()).take(MAX_ENTRIES)
        val arr = JSONArray()
        next.forEach { e ->
            arr.put(
                JSONObject().apply {
                    put("id", e.id)
                    put("pairId", e.pairId)
                    put("text", e.text)
                    put("isError", e.isError)
                    put("timestamp", e.timestamp)
                },
            )
        }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }
}
