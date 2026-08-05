package com.alliminate.android.data

import android.content.Context
import android.os.Build
import androidx.compose.runtime.mutableStateOf
import java.util.UUID

/** Persists this phone's own identity (sent as `requester` during pairing) and the Master Device this
 * phone is currently paired with — mirrors the desktop's device.ts + pairing.ts, minus a local server,
 * since the phone has nothing to pair TO yet (Phase 4 adds that). */
object Prefs {
    private const val FILE = "alliminate_prefs"
    private lateinit var prefs: android.content.SharedPreferences

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        masterHost.value = prefs.getString(KEY_HOST, null)
        masterToken.value = prefs.getString(KEY_TOKEN, null)
        masterName.value = prefs.getString(KEY_NAME, null)
        masterPlatform.value = prefs.getString(KEY_PLATFORM, null)
        masterId.value = prefs.getString(KEY_MASTER_ID, null)
        onboarded.value = prefs.getBoolean(KEY_ONBOARDED, false)
        appLockEnabled.value = prefs.getBoolean(KEY_APP_LOCK, false)
        backupEnabled.value = prefs.getBoolean(KEY_BACKUP_ENABLED, false)
        backupFolderId.value = prefs.getString(KEY_BACKUP_FOLDER_ID, null)
        backupFolderName.value = prefs.getString(KEY_BACKUP_FOLDER_NAME, null)
        nearbyShareEnabled.value = prefs.getBoolean(KEY_NEARBY_SHARE, true)
    }

    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_HOST = "master_host"
    private const val KEY_TOKEN = "master_token"
    private const val KEY_NAME = "master_name"
    private const val KEY_PLATFORM = "master_platform"
    private const val KEY_MASTER_ID = "master_id"
    private const val KEY_ONBOARDED = "onboarded"
    private const val KEY_APP_LOCK = "app_lock_enabled"
    private const val KEY_BACKUP_ENABLED = "backup_enabled"
    private const val KEY_BACKUP_FOLDER_ID = "backup_folder_id"
    private const val KEY_BACKUP_FOLDER_NAME = "backup_folder_name"
    private const val KEY_LAST_BACKUP_AT = "last_backup_at"
    private const val KEY_NEARBY_SHARE = "nearby_share_enabled"

    val masterHost = mutableStateOf<String?>(null)
    val masterToken = mutableStateOf<String?>(null)
    val masterName = mutableStateOf<String?>(null)
    val masterPlatform = mutableStateOf<String?>(null)
    // the Master's own device id (from /pair/verify's response, same shape as getDeviceIdentity() on the
    // Mac) — needed to recognize ITS beacon specifically among every AllieMinate instance broadcasting on
    // the LAN, for hotspot/network-change reconnect (see NearbyBeacon.kt's listener).
    val masterId = mutableStateOf<String?>(null)
    val onboarded = mutableStateOf(false)
    val appLockEnabled = mutableStateOf(false)
    val backupEnabled = mutableStateOf(false)
    val backupFolderId = mutableStateOf<String?>(null)
    val backupFolderName = mutableStateOf<String?>(null)
    val nearbyShareEnabled = mutableStateOf(true)

    val isPaired: Boolean get() = masterHost.value != null && masterToken.value != null

    val deviceId: String
        get() {
            prefs.getString(KEY_DEVICE_ID, null)?.let { return it }
            val id = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
            return id
        }

    val deviceName: String
        get() = "${Build.MANUFACTURER} ${Build.MODEL}".trim().ifBlank { "Android Phone" }

    fun savePairing(host: String, token: String, name: String, platform: String, masterDeviceId: String? = null) {
        masterHost.value = host
        masterToken.value = token
        masterName.value = name
        masterPlatform.value = platform
        masterId.value = masterDeviceId
        prefs.edit()
            .putString(KEY_HOST, host)
            .putString(KEY_TOKEN, token)
            .putString(KEY_NAME, name)
            .putString(KEY_PLATFORM, platform)
            .putString(KEY_MASTER_ID, masterDeviceId)
            .apply()
    }

    /** Called by NearbyBeacon's listener when the Master's beacon reports a different address than what
     * we have on file — the phone-side half of hotspot/network-change reconnect. Host only; token/name/
     * platform/id are unaffected by an IP change. */
    fun updateMasterHost(host: String) {
        masterHost.value = host
        prefs.edit().putString(KEY_HOST, host).apply()
    }

    fun clearPairing() {
        masterHost.value = null
        masterToken.value = null
        masterName.value = null
        masterPlatform.value = null
        masterId.value = null
        prefs.edit().remove(KEY_HOST).remove(KEY_TOKEN).remove(KEY_NAME).remove(KEY_PLATFORM).remove(KEY_MASTER_ID).apply()
        setBackupEnabled(false)
    }

    fun setOnboarded(done: Boolean) {
        onboarded.value = done
        prefs.edit().putBoolean(KEY_ONBOARDED, done).apply()
    }

    fun setAppLockEnabled(enabled: Boolean) {
        appLockEnabled.value = enabled
        prefs.edit().putBoolean(KEY_APP_LOCK, enabled).apply()
    }

    fun setBackupEnabled(enabled: Boolean) {
        backupEnabled.value = enabled
        prefs.edit().putBoolean(KEY_BACKUP_ENABLED, enabled).apply()
    }

    fun setNearbyShareEnabled(enabled: Boolean) {
        nearbyShareEnabled.value = enabled
        prefs.edit().putBoolean(KEY_NEARBY_SHARE, enabled).apply()
    }

    fun setBackupFolder(id: String?, name: String?) {
        backupFolderId.value = id
        backupFolderName.value = name
        prefs.edit().putString(KEY_BACKUP_FOLDER_ID, id).putString(KEY_BACKUP_FOLDER_NAME, name).apply()
    }

    var lastBackupAt: Long
        get() = prefs.getLong(KEY_LAST_BACKUP_AT, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_BACKUP_AT, value).apply()
}
