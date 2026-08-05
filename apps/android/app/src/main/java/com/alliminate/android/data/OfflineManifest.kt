package com.alliminate.android.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class OfflineFile(
    val accountId: String,
    val key: String,
    val name: String,
    val localUri: String,
    val size: Long,
    val mimeType: String,
)

/** Files the user has explicitly pinned to stay available on the phone without a live connection to the
 * Master Device — cached under app-scoped external storage (no permission needed, cleared on uninstall). */
object OfflineManifest {
    private const val FILE = "alliminate_offline_manifest"
    private const val KEY = "offline_files"
    private lateinit var prefs: android.content.SharedPreferences

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    private fun key(accountId: String, fileKey: String) = "$accountId::$fileKey"

    fun list(): List<OfflineFile> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        val arr = JSONArray(raw)
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            OfflineFile(
                accountId = o.getString("accountId"),
                key = o.getString("key"),
                name = o.getString("name"),
                localUri = o.getString("localUri"),
                size = o.getLong("size"),
                mimeType = o.getString("mimeType"),
            )
        }
    }

    fun find(accountId: String, fileKey: String): OfflineFile? = list().find { it.accountId == accountId && it.key == fileKey }

    fun add(file: OfflineFile) {
        val current = list().filterNot { it.accountId == file.accountId && it.key == file.key }
        save(current + file)
    }

    fun remove(accountId: String, fileKey: String) {
        save(list().filterNot { it.accountId == accountId && it.key == fileKey })
    }

    private fun save(files: List<OfflineFile>) {
        val arr = JSONArray()
        files.forEach { f ->
            arr.put(
                JSONObject().apply {
                    put("accountId", f.accountId)
                    put("key", f.key)
                    put("name", f.name)
                    put("localUri", f.localUri)
                    put("size", f.size)
                    put("mimeType", f.mimeType)
                },
            )
        }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }
}
