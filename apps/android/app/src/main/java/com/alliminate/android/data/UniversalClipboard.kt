package com.alliminate.android.data

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Cross-device clipboard sync — a copy on this phone (with the toggle on for at least one paired master)
 * pushes out to every such master; a push landing here writes straight into this phone's own OS
 * clipboard. Lives alongside NearbyBeacon/SyncFileObservers as one more thing LocalServerService starts
 * and stops with the rest of "device sharing is active" (see that service's lifecycle comment). */
object UniversalClipboard {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    // guards BOTH directions against an echo loop: a remote push writes this before setPrimaryClip, so the
    // listener below sees its own change and skips re-broadcasting it; equally, a value we just broadcast
    // ourselves is remembered so a stray duplicate PrimaryClipChanged callback doesn't re-send it.
    @Volatile private var lastKnownText: String? = null
    private var listener: ClipboardManager.OnPrimaryClipChangedListener? = null

    fun start(context: Context) {
        if (listener != null) return
        val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        val l = ClipboardManager.OnPrimaryClipChangedListener {
            // Android 10+ redacts getPrimaryClip() outside focus/default-IME for most apps; this only
            // reliably sees content while the app itself is frontmost — acceptable degradation, matches
            // the platform's own privacy model rather than fighting it.
            val text = runCatching { manager.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString() }.getOrNull()
            if (text.isNullOrBlank() || text == lastKnownText) return@OnPrimaryClipChangedListener
            lastKnownText = text
            broadcastToMasters(text)
        }
        manager.addPrimaryClipChangedListener(l)
        listener = l
    }

    fun stop(context: Context) {
        val l = listener ?: return
        val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        manager?.removePrimaryClipChangedListener(l)
        listener = null
    }

    /** Called from LocalHttpServer when a paired master pushes its own new clipboard text to this phone. */
    fun applyRemoteText(context: Context, text: String) {
        if (text == lastKnownText) return
        lastKnownText = text
        val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
        manager.setPrimaryClip(ClipData.newPlainText("AllieMinate", text))
    }

    private fun broadcastToMasters(text: String) {
        val targets = Prefs.pairedMasters.filter { it.universalClipboardEnabled }
        if (targets.isEmpty()) return
        scope.launch {
            targets.forEach { master ->
                MasterApi.pushClipboard(master.host, master.token, text, Prefs.deviceName)
            }
        }
    }
}
