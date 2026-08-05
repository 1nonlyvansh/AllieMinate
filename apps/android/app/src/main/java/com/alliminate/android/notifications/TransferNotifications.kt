package com.alliminate.android.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.alliminate.android.R
import kotlin.random.Random

/** Real-time progress while a file is going out (phone -> Mac/cloud), and a result notification when a
 * file comes in (Mac -> phone) — the two directions AllieMinate transfers files, both surfaced the same
 * way the rest of the app already posts notifications (LocalServerService's persistent one,
 * MainActivity's USB-pair prompt). */
object TransferNotifications {
    private const val CHANNEL_ID = "alliminate_transfers"
    private const val PROGRESS_ID = 9100
    private const val INCOMING_PROGRESS_ID = 9101
    private const val SYNC_PROGRESS_ID = 9102

    const val ACTION_CONTINUITY = "com.alliminate.android.ACTION_CONTINUITY"
    const val EXTRA_FROM_NAME = "continuity_from_name"
    const val EXTRA_FILE_NAME = "continuity_file_name"
    const val EXTRA_PROVIDER_ID = "continuity_provider_id"
    const val EXTRA_KEY = "continuity_key"
    const val EXTRA_MIME_TYPE = "continuity_mime_type"

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "File Transfers", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Progress and results for files sent to/received from your Master Device"
            },
        )
    }

    private fun hasPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    /** One shared, updated-in-place notification for the file currently going out — percent is 0..100. */
    fun showProgress(context: Context, fileName: String, percent: Int) {
        if (!hasPermission(context)) return
        ensureChannel(context)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Sending \"$fileName\"…")
            .setContentText("$percent%")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, percent, false)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(PROGRESS_ID, notification) }
    }

    fun clearProgress(context: Context) {
        runCatching { NotificationManagerCompat.from(context).cancel(PROGRESS_ID) }
    }

    /** One shared, updated-in-place notification for the Sync Engine's background push — the folder-push
     * that used to run with zero visible feedback (SyncPushWorker's whole point is running unattended), so
     * there was no way to tell "it's working, N%" from "it's stuck" without opening the Sync tab on the
     * paired Mac. Percent is 0..100 across every file changed in this pass, not just one pair. */
    fun showSyncProgress(context: Context, pairName: String, done: Int, total: Int) {
        if (!hasPermission(context) || total <= 0) return
        ensureChannel(context)
        val percent = ((done * 100) / total).coerceIn(0, 100)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Syncing \"$pairName\"…")
            .setContentText("$percent% ($done/$total files)")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, percent, false)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(SYNC_PROGRESS_ID, notification) }
    }

    fun clearSyncProgress(context: Context) {
        runCatching { NotificationManagerCompat.from(context).cancel(SYNC_PROGRESS_ID) }
    }

    /** One shared, updated-in-place notification for the file currently coming IN — matches O+ Connect's
     * style: percent + a Stop action that actually interrupts the transfer mid-flight (via
     * IncomingTransferControl, polled by LocalHttpServer's read loop). */
    fun showIncomingProgress(context: Context, fileName: String, fromDevice: String, percent: Int) {
        if (!hasPermission(context)) return
        ensureChannel(context)
        val stopIntent = Intent(context, StopTransferReceiver::class.java)
        val stopPending = PendingIntent.getBroadcast(context, 0, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("$percent% received")
            .setContentText("From $fromDevice")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, percent, false)
            .addAction(0, "Stop", stopPending)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(INCOMING_PROGRESS_ID, notification) }
    }

    fun clearIncomingProgress(context: Context) {
        runCatching { NotificationManagerCompat.from(context).cancel(INCOMING_PROGRESS_ID) }
    }

    fun showSendResult(context: Context, fileName: String, destination: String, success: Boolean, error: String? = null) {
        clearProgress(context)
        if (!hasPermission(context)) return
        ensureChannel(context)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(if (success) "Sent to $destination" else "Couldn't send \"$fileName\"")
            .setContentText(if (success) fileName else (error ?: "Send failed"))
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(Random.nextInt(20000, 30000), notification) }
    }

    /** Tapping this opens the just-received file directly, like tapping a download notification. */
    fun showReceived(context: Context, fileName: String, contentUri: Uri?, mimeType: String) {
        clearIncomingProgress(context)
        if (!hasPermission(context)) return
        ensureChannel(context)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("File Share Successful")
            .setContentText(fileName)
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
        if (contentUri != null) {
            val openIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(contentUri, mimeType.ifBlank { "*/*" })
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            val pending = PendingIntent.getActivity(
                context, contentUri.hashCode(), openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            builder.setContentIntent(pending)
        }
        runCatching { NotificationManagerCompat.from(context).notify(Random.nextInt(30000, 40000), builder.build()) }
    }

    fun showReceiveFailed(context: Context, fileName: String) {
        clearIncomingProgress(context)
        if (!hasPermission(context)) return
        ensureChannel(context)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("File Share Failed")
            .setContentText("Couldn't save \"$fileName\"")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(Random.nextInt(30000, 40000), notification) }
    }

    /** Nearby Share's actual consent step — this device has no prior pairing with the sender, so this
     * notification (not a silent auto-accept) is where the user grants or refuses the transfer. */
    fun showNearbyRequest(context: Context, requestId: String, fromName: String, fileName: String) {
        if (!hasPermission(context)) return
        ensureChannel(context)
        val acceptIntent = Intent(context, NearbyRequestReceiver::class.java).apply {
            putExtra(NearbyRequestReceiver.EXTRA_REQUEST_ID, requestId)
            putExtra(NearbyRequestReceiver.EXTRA_ACCEPT, true)
        }
        val declineIntent = Intent(context, NearbyRequestReceiver::class.java).apply {
            putExtra(NearbyRequestReceiver.EXTRA_REQUEST_ID, requestId)
            putExtra(NearbyRequestReceiver.EXTRA_ACCEPT, false)
        }
        val acceptPending = PendingIntent.getBroadcast(context, requestId.hashCode(), acceptIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val declinePending = PendingIntent.getBroadcast(context, requestId.hashCode() + 1, declineIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Nearby Share request")
            .setContentText("$fromName wants to send you \"$fileName\"")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setAutoCancel(true)
            .addAction(0, "Decline", declinePending)
            .addAction(0, "Accept", acceptPending)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(requestId.hashCode(), notification) }
    }

    fun clearNearbyRequest(context: Context, requestId: String) {
        runCatching { NotificationManagerCompat.from(context).cancel(requestId.hashCode()) }
    }

    /** Phase 3's actual consent step — a paired Mac wants this phone to approve unlocking its in-app App
     * Lock. Higher priority than Nearby Share's request (this is a security decision, not a file), and
     * unlike Nearby Share this sender is already a trusted paired device — the notification is still
     * accept/decline, not silent, because approving an unlock is a bigger deal than accepting a file. */
    fun showUnlockRequest(context: Context, requestId: String, fromName: String) {
        if (!hasPermission(context)) return
        ensureChannel(context)
        val acceptIntent = Intent(context, UnlockRequestReceiver::class.java).apply {
            putExtra(UnlockRequestReceiver.EXTRA_REQUEST_ID, requestId)
            putExtra(UnlockRequestReceiver.EXTRA_ACCEPT, true)
        }
        val declineIntent = Intent(context, UnlockRequestReceiver::class.java).apply {
            putExtra(UnlockRequestReceiver.EXTRA_REQUEST_ID, requestId)
            putExtra(UnlockRequestReceiver.EXTRA_ACCEPT, false)
        }
        val acceptPending = PendingIntent.getBroadcast(context, requestId.hashCode() + 2, acceptIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val declinePending = PendingIntent.getBroadcast(context, requestId.hashCode() + 3, declineIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Unlock approval request")
            .setContentText("$fromName wants you to approve its unlock")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_SOCIAL)
            .setAutoCancel(true)
            .addAction(0, "Decline", declinePending)
            .addAction(0, "Approve", acceptPending)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(requestId.hashCode() + 1, notification) }
    }

    fun clearUnlockRequest(context: Context, requestId: String) {
        runCatching { NotificationManagerCompat.from(context).cancel(requestId.hashCode() + 1) }
    }

    /** "now viewing X" presence signal from a paired Master Device — tapping downloads the same file from
     * that device (via MasterApi, the same cloud-provider route Cloud Services already uses) and opens it
     * directly. No accept/decline step like Nearby Share: this is already a trusted paired peer. */
    fun showContinuity(context: Context, fromName: String, fileName: String, providerId: String, key: String, mimeType: String?) {
        if (!hasPermission(context)) return
        ensureChannel(context)
        val openIntent = Intent(context, com.alliminate.android.MainActivity::class.java).apply {
            action = ACTION_CONTINUITY
            putExtra(EXTRA_FROM_NAME, fromName)
            putExtra(EXTRA_FILE_NAME, fileName)
            putExtra(EXTRA_PROVIDER_ID, providerId)
            putExtra(EXTRA_KEY, key)
            putExtra(EXTRA_MIME_TYPE, mimeType)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pending = PendingIntent.getActivity(
            context, (fromName + key).hashCode(), openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Continue on this phone?")
            .setContentText("$fromName is viewing \"$fileName\"")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify((fromName + key).hashCode(), notification) }
    }

    fun showReceiveCancelled(context: Context, fileName: String) {
        clearIncomingProgress(context)
        if (!hasPermission(context)) return
        ensureChannel(context)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle("Transfer Stopped")
            .setContentText("\"$fileName\" wasn't fully received")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(context).notify(Random.nextInt(30000, 40000), notification) }
    }
}
