package com.alliminate.android.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.Prefs
import com.alliminate.android.data.SyncActivityStore
import com.alliminate.android.data.SyncFileRecord
import com.alliminate.android.data.SyncFileStateStore
import com.alliminate.android.data.SyncPair
import com.alliminate.android.data.SyncPairStore
import com.alliminate.android.notifications.TransferNotifications
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

private const val WORK_NAME = "sync_engine_push"
private const val MAX_CONCURRENT_UPLOADS = 3

// Same defaults the desktop backend's ignoreRules.ts seeds — kept in sync deliberately so a folder synced
// from either side behaves the same way about what never gets pushed.
private val IGNORED_NAMES = setOf(".DS_Store", ".git", "node_modules", ".localized")
private fun isIgnored(name: String) = name.startsWith(".") || name in IGNORED_NAMES || name.endsWith(".tmp")

private data class PendingUpload(val pair: SyncPair, val file: File, val record: SyncFileRecord?)

/** Sync Engine (Android) Phase 1/2 — one-way push only (phone → chosen cloud folder), top-level files in
 * the chosen folder only (no recursive subfolder walk yet — Phase 3 territory, matching the desktop
 * roadmap). Runs for every active Sync Pair on each wake; a single failed pair doesn't block the others
 * from getting their turn, matching the desktop engine's per-folder isolation.
 *
 * Uploads across ALL pending files (any pair) run with bounded concurrency instead of one at a time — a
 * folder with many changed files (a camera-roll dump, a big batch of new photos) used to sum every single
 * file's own network round trip through the Master relay sequentially, which is the real cause behind
 * "sync feels slow." Overlapping a handful of uploads at once cuts that wall-clock time substantially
 * without hammering the phone's radio or the Master's own connection pool. */
class SyncPushWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val host = Prefs.masterHost.value
        val token = Prefs.masterToken.value
        if (host == null || token == null) return Result.success() // not paired — nothing to push to

        val activePairs = SyncPairStore.list().filter { it.status == "active" }
        // per-pair mutable state, shared across possibly-concurrent uploads FROM THE SAME PAIR — a plain
        // HashMap would race two parallel coroutines both calling put() for different files in the same
        // pair; ConcurrentHashMap makes that safe without needing a separate lock per pair.
        val stateByPair = activePairs.associate { it.id to ConcurrentHashMap(SyncFileStateStore.load(it.id)) }

        val pending = mutableListOf<PendingUpload>()
        for (pair in activePairs) {
            val dir = File(pair.localPath)
            if (!dir.isDirectory) {
                SyncActivityStore.record(pair.id, "\"${pair.name}\" — folder no longer exists on this phone", isError = true)
                continue
            }
            val state = stateByPair.getValue(pair.id)
            val files = dir.listFiles { f -> f.isFile && !isIgnored(f.name) } ?: emptyArray()
            for (file in files) {
                val record = state[file.name]
                val unchanged = record != null && record.size == file.length() && record.modifiedAt == file.lastModified()
                if (!unchanged) pending.add(PendingUpload(pair, file, record))
            }
        }

        if (pending.isEmpty()) return Result.success()

        val doneCount = AtomicInteger(0)
        val anyFailure = AtomicBoolean(false)
        val semaphore = Semaphore(MAX_CONCURRENT_UPLOADS)

        try {
            coroutineScope {
                pending.map { item ->
                    async {
                        semaphore.withPermit {
                            val state = stateByPair.getValue(item.pair.id)
                            val result = runCatching {
                                item.file.inputStream().use { input ->
                                    MasterApi.uploadStreamToProvider(host, token, item.pair.providerId, item.file.name, input, folderId = item.pair.remoteFolderId)
                                }
                            }.getOrElse { ApiResult.Err(it.message ?: "upload failed") }

                            when (result) {
                                is ApiResult.Ok -> {
                                    state[item.file.name] = SyncFileRecord(
                                        size = item.file.length(),
                                        modifiedAt = item.file.lastModified(),
                                        lastSyncedAt = System.currentTimeMillis(),
                                        status = "synced",
                                    )
                                    SyncActivityStore.record(item.pair.id, "Synced ${item.file.name}")
                                }
                                is ApiResult.Err -> {
                                    anyFailure.set(true)
                                    state[item.file.name] = SyncFileRecord(
                                        size = item.file.length(),
                                        modifiedAt = item.file.lastModified(),
                                        lastSyncedAt = item.record?.lastSyncedAt ?: 0L,
                                        status = "error",
                                        lastError = result.message,
                                    )
                                    SyncActivityStore.record(item.pair.id, "Failed to sync ${item.file.name}: ${result.message}", isError = true)
                                }
                            }

                            val done = doneCount.incrementAndGet()
                            TransferNotifications.showSyncProgress(applicationContext, item.pair.name, done, pending.size)
                        }
                    }
                }.awaitAll()
            }
        } finally {
            stateByPair.forEach { (pairId, state) -> SyncFileStateStore.save(pairId, state) }
            TransferNotifications.clearSyncProgress(applicationContext)
        }

        return if (anyFailure.get()) Result.retry() else Result.success()
    }
}

object SyncPushScheduler {
    /** One-shot, fired right when a pair is created, the user taps "Sync Now", or FileObserver sees a
     * local change — so the first push happens immediately instead of waiting for the next periodic tick.
     * Shares WORK_NAME with the periodic chain below via KEEP: if a push is already enqueued/running (a
     * FileObserver debounce firing on top of a periodic tick, or two FileObserver events landing close
     * together), this skips instead of stacking a second concurrent run. Two overlapping runs both reading
     * SyncFileStateStore before either had saved was producing real MEGA duplicates — same race the
     * desktop engine's reconcilingIds guard exists to prevent, ported here for the same reason. A skipped
     * request isn't a missed one: the next natural trigger (debounce, periodic tick) picks up whatever
     * changed since. */
    fun runOnce(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<SyncPushWorker>().build())
    }

    /** 15 minutes is WorkManager's actual floor for periodic work — Android doesn't allow tighter periodic
     * intervals regardless of what an app asks for, this isn't a choice made here. Any faster/near-real-
     * time detection (FileObserver etc) is separate, additive scheduling, not a replacement for this. */
    fun start(context: Context) {
        val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
        val request = PeriodicWorkRequestBuilder<SyncPushWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun stop(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }
}
