package com.alliminate.android.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Mirrors the desktop's UniversalSyncInvite shape (packages/shared/src/types.ts) exactly — this is the
 * literal JSON body the host POSTs to /universal-sync/invite on this phone's own LocalHttpServer, the same
 * push mechanism already used for /continuity and /unlock/request. `masterId` isn't part of the shared
 * wire shape; it's stamped on locally (the id of the PairedMaster whose Bearer token authenticated the
 * request) since accept/decline needs to know which paired PC to talk back to and a phone can have up to
 * five paired at once. */
data class UniversalSyncInvite(
    val id: String,
    val hostDeviceId: String,
    val hostDeviceName: String,
    val hostFolderId: String,
    val universalSyncId: String,
    val name: String,
    val permission: String, // "read-write" | "read-only" | "write-only"
    val status: String, // "pending" | "accepted" | "declined"
    val createdAt: String,
    val masterId: String,
)

/** JSON-backed registry for invites this phone has RECEIVED — same SharedPreferences-string pattern as
 * SyncPairStore. Persisted (not in-memory) since a Universal Sync invite must survive this phone being
 * offline or the app being closed when it arrives, same reasoning as the desktop's own invite store. */
object UniversalSyncInviteStore {
    private const val FILE = "alliminate_universal_sync_invites"
    private const val KEY = "invites"
    private lateinit var prefs: android.content.SharedPreferences

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    fun list(): List<UniversalSyncInvite> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        val arr = JSONArray(raw)
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            UniversalSyncInvite(
                id = o.getString("id"),
                hostDeviceId = o.getString("hostDeviceId"),
                hostDeviceName = o.getString("hostDeviceName"),
                hostFolderId = o.getString("hostFolderId"),
                universalSyncId = o.getString("universalSyncId"),
                name = o.getString("name"),
                permission = o.getString("permission"),
                status = o.optString("status").ifBlank { "pending" },
                createdAt = o.getString("createdAt"),
                masterId = o.getString("masterId"),
            )
        }
    }

    fun pending(): List<UniversalSyncInvite> = list().filter { it.status == "pending" }

    fun add(invite: UniversalSyncInvite) {
        save(list().filterNot { it.id == invite.id } + invite)
    }

    fun updateStatus(id: String, status: String) {
        save(list().map { if (it.id == id) it.copy(status = status) else it })
    }

    private fun save(invites: List<UniversalSyncInvite>) {
        val arr = JSONArray()
        invites.forEach { i ->
            arr.put(
                JSONObject().apply {
                    put("id", i.id)
                    put("hostDeviceId", i.hostDeviceId)
                    put("hostDeviceName", i.hostDeviceName)
                    put("hostFolderId", i.hostFolderId)
                    put("universalSyncId", i.universalSyncId)
                    put("name", i.name)
                    put("permission", i.permission)
                    put("status", i.status)
                    put("createdAt", i.createdAt)
                    put("masterId", i.masterId)
                },
            )
        }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }
}
