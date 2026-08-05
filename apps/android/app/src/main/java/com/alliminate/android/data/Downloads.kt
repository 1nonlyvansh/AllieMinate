package com.alliminate.android.data

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream

/** Saves a downloaded cloud file into the phone's public Downloads folder — MediaStore on API 29+
 * (scoped storage, no permission needed), a direct file write on 26-28 (needs WRITE_EXTERNAL_STORAGE,
 * requested by the caller first). Returns the resulting content Uri for opening/previewing. */
object Downloads {

    fun guessMimeType(fileName: String, fallback: String?): String {
        val ext = fileName.substringAfterLast('.', "")
        if (ext.isNotEmpty()) {
            MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.lowercase())?.let { return it }
        }
        return fallback?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
    }

    fun save(context: Context, fileName: String, mimeType: String, bytes: ByteArray): Uri? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(context, fileName, mimeType, bytes)
        } else {
            saveLegacy(fileName, bytes)
        }
    }.getOrNull()

    private fun saveViaMediaStore(context: Context, fileName: String, mimeType: String, bytes: ByteArray): Uri? {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, fileName)
            put(MediaStore.Downloads.MIME_TYPE, mimeType)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
        resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return null
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        return uri
    }

    private fun saveLegacy(fileName: String, bytes: ByteArray): Uri? {
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, fileName)
        FileOutputStream(file).use { it.write(bytes) }
        return Uri.fromFile(file)
    }

    /** Caches a file under this app's own external-files "offline" folder — no storage permission needed,
     * survives app updates, wiped on uninstall. Returns a FileProvider content Uri (shareable/openable by
     * other apps, unlike a raw file:// Uri which API24+ blocks across app boundaries). */
    fun saveOffline(context: Context, fileName: String, bytes: ByteArray): Uri? {
        val dir = File(context.getExternalFilesDir(null), "offline")
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, fileName)
        return runCatching {
            FileOutputStream(file).use { it.write(bytes) }
            FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        }.getOrNull()
    }
}
