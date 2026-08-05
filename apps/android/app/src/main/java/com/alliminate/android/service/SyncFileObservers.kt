package com.alliminate.android.service

import android.content.Context
import android.os.FileObserver
import android.os.Handler
import android.os.Looper
import com.alliminate.android.data.SyncPairStore
import com.alliminate.android.work.SyncPushScheduler

private const val DEBOUNCE_MS = 3000L
private const val WATCH_MASK = FileObserver.CREATE or FileObserver.CLOSE_WRITE or FileObserver.MOVED_TO

/** Near-instant local-change detection for active Sync Pairs, riding LocalServerService's lifecycle rather
 * than a foreground service of its own — the whole reason for that is to avoid repeating the
 * ForegroundServiceDidNotStopInTimeException mistake: no new service means no new place to get the
 * onTimeout/onDestroy stop-time budget wrong. FileObserver watches one folder non-recursively, matching
 * Phase 1's top-level-only scope; the 15-minute WorkManager scan in SyncPushWorker stays as the fallback
 * for whenever this process isn't alive to observe anything (phone rebooted, app force-stopped). */
object SyncFileObservers {
    private val observers = mutableListOf<FileObserver>()
    private val handler = Handler(Looper.getMainLooper())
    private var debounceRunnable: Runnable? = null
    private var appContext: Context? = null

    fun start(context: Context) {
        appContext = context.applicationContext
        refresh()
    }

    /** Call after any Sync Pair is added/removed/paused/resumed so the watched folder set stays current —
     * cheap to call unconditionally since it's just re-registering a handful of directory watches. */
    fun refresh() {
        val context = appContext ?: return
        stopWatching()
        SyncPairStore.list().filter { it.status == "active" }.forEach { pair ->
            @Suppress("DEPRECATION") // the String-path constructor is deprecated in favor of File, but is
            // the only one available before API 29 — minSdk here is 26, and it still works correctly on
            // every API level up to the latest, so there's no real reason to version-branch for this.
            val observer = object : FileObserver(pair.localPath, WATCH_MASK) {
                override fun onEvent(event: Int, path: String?) {
                    if (path == null || path.startsWith(".")) return // dotfiles handled again in the
                    // worker's own ignore check too, but skipping here avoids scheduling a push at all
                    // for the most common noise source (Finder-equivalent .nomedia/.thumbnails writes).
                    scheduleDebouncedPush(context)
                }
            }
            runCatching { observer.startWatching() }.onSuccess { observers.add(observer) }
        }
    }

    fun stop() {
        stopWatching()
        handler.removeCallbacksAndMessages(null)
        debounceRunnable = null
        appContext = null
    }

    private fun stopWatching() {
        observers.forEach { runCatching { it.stopWatching() } } // never blocks — safe to call from
        // onTimeout/onDestroy's stop-time budget, unlike NanoHTTPD's own stop() which is why that one
        // needed a background thread instead.
        observers.clear()
    }

    private fun scheduleDebouncedPush(context: Context) {
        debounceRunnable?.let { handler.removeCallbacks(it) }
        val runnable = Runnable { SyncPushScheduler.runOnce(context) }
        debounceRunnable = runnable
        handler.postDelayed(runnable, DEBOUNCE_MS)
    }
}
