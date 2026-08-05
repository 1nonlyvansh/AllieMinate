package com.alliminate.android.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.alliminate.android.R

private const val CHANNEL_ID = "alliminate_device_sharing"
private const val NOTIFICATION_ID = 1001

/** Keeps LocalHttpServer alive so the paired Master Device can reach this phone over LAN even when the
 * app isn't in the foreground — required for a foreground service on Android 8+, hence the persistent
 * notification (matches how any LAN-sharing app has to behave: user-visible while active, easy to stop
 * from Settings). */
class LocalServerService : Service() {
    private var server: LocalHttpServer? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // a foreground service that fails to post a valid notification gets killed by the OS along with
        // the whole app process (BadForegroundServiceNotification) — never let that take the app down.
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, buildNotification(), android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIFICATION_ID, buildNotification())
            }
            if (server == null) {
                server = LocalHttpServer(applicationContext).also { it.start(fi.iki.elonen.NanoHTTPD.SOCKET_READ_TIMEOUT, false) }
            }
            // Nearby Share needs to be discoverable even before/without any pairing, so its beacon rides
            // this service's lifecycle directly rather than being gated on Prefs.isPaired the way the rest
            // of this service historically has been.
            NearbyBeacon.start()
            NearbyBeacon.startListening()
            SyncFileObservers.start(applicationContext)
            // battery-optimization exemption only keeps the CPU/process alive under Doze — it says nothing
            // about the WiFi RADIO, which independently drops into 802.11 power-save while the screen is
            // off, only waking for its DTIM beacon interval. That's exactly what made the Master Device see
            // this phone as "offline" a minute or two after lock even with background sync unrestricted: the
            // server was alive and listening the whole time, incoming connections just weren't reaching the
            // radio promptly enough to beat the Mac's connection timeout. A high-perf WiFi lock keeps the
            // radio itself out of power-save for as long as this service runs.
            if (wifiLock == null) {
                val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                wifiLock = wifiManager?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "AllieMinate:deviceSharing")?.apply {
                    setReferenceCounted(false)
                    runCatching { acquire() }
                }
            }
        } catch (err: Exception) {
            stopSelf()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        NearbyBeacon.stop()
        NearbyBeacon.stopListening()
        SyncFileObservers.stop()
        stopServerInBackground()
        wifiLock?.let { if (it.isHeld) runCatching { it.release() } }
        wifiLock = null
        super.onDestroy()
    }

    // Android 15+ (API 35) enforces a hard execution-time limit on dataSync foreground services and calls
    // this when it's hit, expecting the service to ACTUALLY STOP within a few seconds — not just for
    // stopSelf() to be called, but for the whole callback chain (onTimeout -> onDestroy) to return. The
    // real bug: onDestroy used to call NanoHTTPD's server.stop() synchronously on the main thread, and
    // NanoHTTPD's stop() joins its accept thread AND any in-flight request-handling thread with no
    // timeout — a request that happened to be mid-transfer (an active upload/download from the Master
    // Device) had its handler thread blocked in a socket read/write, so join() sat there past the grace
    // window regardless of how fast stopSelf() was called, and the OS killed the whole app with
    // ForegroundServiceDidNotStopInTimeException. Tearing the server down on a separate thread means
    // onTimeout/onDestroy return immediately either way, satisfying the OS's stop-time budget even if the
    // actual socket teardown takes longer in the background.
    override fun onTimeout(startId: Int, fgsType: Int) {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopServerInBackground()
        stopSelf(startId)
    }

    private fun stopServerInBackground() {
        val toStop = server
        server = null
        if (toStop == null) return
        Thread {
            runCatching { toStop.stop() }
        }.apply {
            isDaemon = true
            start()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Device Sharing", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Keeps this phone reachable from your paired Mac or Windows PC"
            },
        )
    }

    private fun buildNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("AllieMinate device sharing is on")
            .setContentText("Your Master Device can browse and send files to this phone")
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()

    companion object {
        fun start(context: Context) {
            // starting a foreground service can be refused outright by the OS (e.g. Android 12+ background
            // start restrictions) — that should just mean "device sharing didn't start", never a crash.
            runCatching {
                val intent = Intent(context, LocalServerService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocalServerService::class.java))
        }
    }
}
