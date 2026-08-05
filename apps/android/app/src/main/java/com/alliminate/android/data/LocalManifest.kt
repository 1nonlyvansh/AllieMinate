package com.alliminate.android.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class ReceivedFile(
    val name: String,
    val uri: String,
    val size: Long,
    val mimeType: String,
    val addedAt: Long,
)

/** Tracks files AllieMinate itself has put on this phone — either downloaded from a Master Device's
 * cloud (Phase 2) or pushed here via "Share to Device" (Phase 3). This is the phone's "received" folder
 * the local HTTP server exposes to the Master, deliberately scoped to AllieMinate's own files rather than
 * the whole phone filesystem — no MANAGE_EXTERNAL_STORAGE, no OS version landmines. */
object LocalManifest {
    private const val FILE = "alliminate_local_manifest"
    private const val KEY = "received_files"
    private lateinit var prefs: android.content.SharedPreferences

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    }

    fun list(): List<ReceivedFile> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        val arr = JSONArray(raw)
        return (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            ReceivedFile(
                name = o.getString("name"),
                uri = o.getString("uri"),
                size = o.getLong("size"),
                mimeType = o.getString("mimeType"),
                addedAt = o.getLong("addedAt"),
            )
        }
    }

    fun add(file: ReceivedFile) {
        val current = list().filterNot { it.name == file.name }
        val arr = JSONArray()
        (current + file).forEach { f ->
            arr.put(
                JSONObject().apply {
                    put("name", f.name)
                    put("uri", f.uri)
                    put("size", f.size)
                    put("mimeType", f.mimeType)
                    put("addedAt", f.addedAt)
                },
            )
        }
        prefs.edit().putString(KEY, arr.toString()).apply()
    }

    fun find(name: String): ReceivedFile? = list().find { it.name == name }
}
