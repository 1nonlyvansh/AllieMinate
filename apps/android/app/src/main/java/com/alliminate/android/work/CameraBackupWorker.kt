package com.alliminate.android.work

import android.content.Context
import android.provider.MediaStore
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.Prefs
import java.util.concurrent.TimeUnit

private const val WORK_NAME = "camera_backup"
private const val BATCH_LIMIT = 20 // cap per run so one wake doesn't try to push a whole gallery at once

/** Backs up new camera-roll photos to the Master Device's chosen cloud service — same provider-targeted
 * upload route ShareScreen and the desktop Finder-style picker use. Runs on a WiFi-only WorkManager
 * schedule so it behaves like any other backup app: quiet, background, no mobile-data surprises. */
class CameraBackupWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val master = Prefs.masterById(Prefs.backupMasterId.value)
        val host = master?.host
        val token = master?.token
        val providerId = Prefs.backupFolderId.value
        if (!Prefs.backupEnabled.value || host == null || token == null || providerId == null) return Result.success()

        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.DATE_ADDED,
        )
        val sinceSeconds = Prefs.lastBackupAt / 1000
        val newPhotos = runCatching {
            applicationContext.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                "${MediaStore.Images.Media.DATE_ADDED} > ?",
                arrayOf(sinceSeconds.toString()),
                "${MediaStore.Images.Media.DATE_ADDED} ASC LIMIT $BATCH_LIMIT",
            )?.use { cursor ->
                val idCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val nameCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val dateCol = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
                buildList {
                    while (cursor.moveToNext()) {
                        add(Triple(cursor.getLong(idCol), cursor.getString(nameCol) ?: "photo", cursor.getLong(dateCol)))
                    }
                }
            }
        }.getOrNull() ?: return Result.retry()

        for ((id, name, dateAddedSeconds) in newPhotos) {
            val uri = android.content.ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
            val bytes = runCatching { applicationContext.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
            if (bytes == null) continue

            val result = MasterApi.uploadBytesToProvider(host, token, providerId, name, bytes)
            if (result is ApiResult.Err) return Result.retry()

            Prefs.lastBackupAt = dateAddedSeconds * 1000
        }

        return Result.success()
    }
}

object CameraBackupScheduler {
    fun start(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build()
        val request = PeriodicWorkRequestBuilder<CameraBackupWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun stop(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }
}
