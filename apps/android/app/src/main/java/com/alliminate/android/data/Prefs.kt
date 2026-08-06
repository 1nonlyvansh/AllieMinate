package com.alliminate.android.data

import android.content.Context
import android.os.Build
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.SnapshotStateList
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** One paired desktop (Mac or Windows) this phone can talk to — mirrors a row in the desktop's own
 * device.ts pairing registry, minus a local server, since the phone has nothing to pair TO yet. */
data class PairedMaster(
    val id: String,
    val host: String,
    val token: String,
    val name: String,
    val platform: String,
)

/** Persists this phone's own identity (sent as `requester` during pairing) and every Master Device this
 * phone is currently paired with — up to MAX_PAIRED_MASTERS at once, since a phone reasonably has both a
 * home Mac and a work Windows PC (or more) paired simultaneously. */
object Prefs {
    private const val FILE = "alliminate_prefs"
    private lateinit var prefs: android.content.SharedPreferences

    const val MAX_PAIRED_MASTERS = 5

    fun init(context: Context) {
        if (::prefs.isInitialized) return
        prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
        loadPairedMasters()
        onboarded.value = prefs.getBoolean(KEY_ONBOARDED, false)
        appLockEnabled.value = prefs.getBoolean(KEY_APP_LOCK, false)
        backupEnabled.value = prefs.getBoolean(KEY_BACKUP_ENABLED, false)
        backupMasterId.value = prefs.getString(KEY_BACKUP_MASTER_ID, null)
        backupFolderId.value = prefs.getString(KEY_BACKUP_FOLDER_ID, null)
        backupFolderName.value = prefs.getString(KEY_BACKUP_FOLDER_NAME, null)
        nearbyShareEnabled.value = prefs.getBoolean(KEY_NEARBY_SHARE, true)
    }

    /** New installs (and installs already migrated) read/write KEY_MASTERS_JSON only. Existing users
     * upgrading from the single-master build have their old singular fields synthesized into a one-element
     * list on first launch, so nobody's existing pairing silently disappears. The legacy keys are left in
     * place afterward (harmless, unread from then on) rather than deleted, in case of a rollback. */
    private fun loadPairedMasters() {
        val json = prefs.getString(KEY_MASTERS_JSON, null)
        if (json != null) {
            pairedMasters.clear()
            pairedMasters.addAll(parseMasters(json))
            return
        }
        val legacyHost = prefs.getString(KEY_HOST, null)
        val legacyToken = prefs.getString(KEY_TOKEN, null)
        if (legacyHost != null && legacyToken != null) {
            pairedMasters.add(
                PairedMaster(
                    id = prefs.getString(KEY_MASTER_ID, null) ?: UUID.randomUUID().toString(),
                    host = legacyHost,
                    token = legacyToken,
                    name = prefs.getString(KEY_NAME, null) ?: "Paired PC",
                    platform = prefs.getString(KEY_PLATFORM, null) ?: "unknown",
                )
            )
            persistMasters()
        }
    }

    private fun parseMasters(json: String): List<PairedMaster> {
        val arr = JSONArray(json)
        return (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            PairedMaster(
                id = o.getString("id"),
                host = o.getString("host"),
                token = o.getString("token"),
                name = o.getString("name"),
                platform = o.getString("platform"),
            )
        }
    }

    private fun persistMasters() {
        val arr = JSONArray()
        pairedMasters.forEach { m ->
            arr.put(
                JSONObject().apply {
                    put("id", m.id)
                    put("host", m.host)
                    put("token", m.token)
                    put("name", m.name)
                    put("platform", m.platform)
                }
            )
        }
        prefs.edit().putString(KEY_MASTERS_JSON, arr.toString()).apply()
    }

    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_HOST = "master_host"
    private const val KEY_TOKEN = "master_token"
    private const val KEY_NAME = "master_name"
    private const val KEY_PLATFORM = "master_platform"
    private const val KEY_MASTER_ID = "master_id"
    private const val KEY_MASTERS_JSON = "paired_masters_json"
    private const val KEY_ONBOARDED = "onboarded"
    private const val KEY_APP_LOCK = "app_lock_enabled"
    private const val KEY_BACKUP_ENABLED = "backup_enabled"
    private const val KEY_BACKUP_MASTER_ID = "backup_master_id"
    private const val KEY_BACKUP_FOLDER_ID = "backup_folder_id"
    private const val KEY_BACKUP_FOLDER_NAME = "backup_folder_name"
    private const val KEY_LAST_BACKUP_AT = "last_backup_at"
    private const val KEY_NEARBY_SHARE = "nearby_share_enabled"

    val pairedMasters: SnapshotStateList<PairedMaster> = mutableStateListOf()

    val onboarded = mutableStateOf(false)
    val appLockEnabled = mutableStateOf(false)
    val backupEnabled = mutableStateOf(false)
    // which paired master owns the active Camera Backup destination — needed so unpairing ONE of several
    // masters only turns off backup if that master was the one backup was actually configured against.
    val backupMasterId = mutableStateOf<String?>(null)
    val backupFolderId = mutableStateOf<String?>(null)
    val backupFolderName = mutableStateOf<String?>(null)
    val nearbyShareEnabled = mutableStateOf(true)

    val isPaired: Boolean get() = pairedMasters.isNotEmpty()

    /** First paired master — for call sites not yet worth a full device picker (e.g. a lone status ping).
     * Prefer iterating pairedMasters directly for anything that should act across every paired PC. */
    val primaryMaster: PairedMaster? get() = pairedMasters.firstOrNull()

    fun masterById(id: String?): PairedMaster? = pairedMasters.firstOrNull { it.id == id }

    val deviceId: String
        get() {
            prefs.getString(KEY_DEVICE_ID, null)?.let { return it }
            val id = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_DEVICE_ID, id).apply()
            return id
        }

    val deviceName: String
        get() = "${Build.MANUFACTURER} ${Build.MODEL}".trim().ifBlank { "Android Phone" }

    /** Adds a new paired master, or updates one already paired with this masterDeviceId (e.g. re-pairing
     * after its host changed). Returns false without changing anything if this would be a NEW pairing past
     * the MAX_PAIRED_MASTERS cap, so callers can show a clear "unpair one first" error. */
    fun savePairing(host: String, token: String, name: String, platform: String, masterDeviceId: String? = null): Boolean {
        val id = masterDeviceId ?: UUID.randomUUID().toString()
        val existingIndex = pairedMasters.indexOfFirst { it.id == id }
        val entry = PairedMaster(id, host, token, name, platform)
        if (existingIndex >= 0) {
            pairedMasters[existingIndex] = entry
        } else {
            if (pairedMasters.size >= MAX_PAIRED_MASTERS) return false
            pairedMasters.add(entry)
        }
        persistMasters()
        return true
    }

    /** Called by NearbyBeacon's listener when a paired Master's beacon reports a different address than
     * what we have on file — the phone-side half of hotspot/network-change reconnect. Host only;
     * token/name/platform/id are unaffected by an IP change. */
    fun updateMasterHost(masterId: String, host: String) {
        val index = pairedMasters.indexOfFirst { it.id == masterId }
        if (index < 0) return
        pairedMasters[index] = pairedMasters[index].copy(host = host)
        persistMasters()
    }

    /** Unpairs exactly one master, leaving the others untouched. */
    fun clearPairing(masterId: String) {
        val removed = pairedMasters.removeAll { it.id == masterId }
        if (!removed) return
        persistMasters()
        if (masterId == backupMasterId.value) setBackupEnabled(false)
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

    fun setBackupFolder(masterId: String?, id: String?, name: String?) {
        backupMasterId.value = masterId
        backupFolderId.value = id
        backupFolderName.value = name
        prefs.edit()
            .putString(KEY_BACKUP_MASTER_ID, masterId)
            .putString(KEY_BACKUP_FOLDER_ID, id)
            .putString(KEY_BACKUP_FOLDER_NAME, name)
            .apply()
    }

    var lastBackupAt: Long
        get() = prefs.getLong(KEY_LAST_BACKUP_AT, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_BACKUP_AT, value).apply()
}
