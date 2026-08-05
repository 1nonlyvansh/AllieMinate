package com.alliminate.android

import android.app.Application
import com.alliminate.android.data.LocalManifest
import com.alliminate.android.data.OfflineManifest
import com.alliminate.android.data.Prefs
import com.alliminate.android.data.SyncActivityStore
import com.alliminate.android.data.SyncFileStateStore
import com.alliminate.android.data.SyncPairStore

class AllieMinateApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashHandler.install(this)

        // These used to only get initialized from MainActivity.onCreate() — fine as long as the user
        // opened the app first, but WorkManager can restart this process headlessly after a reboot (its
        // own RescheduleReceiver fires on BOOT_COMPLETED once periodic work exists) and run SyncPushWorker
        // or CameraBackupWorker before MainActivity ever runs. Every one of these reads back as its
        // class-level default in that case (host/token null, backup disabled), so both workers silently
        // early-return believing the phone is unpaired — background sync and camera backup just stop
        // working after every reboot until the user manually reopens the app. init() on each of these is
        // idempotent (guarded by `if (::prefs.isInitialized) return`), so calling them again from
        // MainActivity right after is harmless.
        Prefs.init(this)
        LocalManifest.init(this)
        OfflineManifest.init(this)
        SyncPairStore.init(this)
        SyncFileStateStore.init(this)
        SyncActivityStore.init(this)
    }
}
