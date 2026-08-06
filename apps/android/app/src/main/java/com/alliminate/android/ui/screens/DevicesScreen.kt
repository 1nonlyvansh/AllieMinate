package com.alliminate.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import com.alliminate.android.data.LocalNetwork
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.PairedMaster
import com.alliminate.android.data.PairingStatus
import com.alliminate.android.data.Prefs
import com.alliminate.android.service.LOCAL_SERVER_PORT
import com.alliminate.android.service.LocalServerService
import com.alliminate.android.ui.components.PairDeviceDialog
import com.alliminate.android.ui.components.ScreenHeader
import com.alliminate.android.ui.components.ScreenScaffold
import com.alliminate.android.ui.theme.LocalAllieMinateColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val PING_INTERVAL_MS = 5000L

@Composable
fun DevicesScreen(onOpenDrawer: () -> Unit) {
    var showPairDialog by remember { mutableStateOf(false) }
    var onlineById by remember { mutableStateOf<Map<String, Boolean?>>(emptyMap()) }
    var sharingActive by remember { mutableStateOf<Boolean?>(null) }
    var refreshTick by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val masters = Prefs.pairedMasters

    // one paired master's token is enough to authenticate any request this phone's own LocalHttpServer
    // sees (see LocalHttpServer.serve()'s multi-token check) — used below for self-pings/self-announces
    // that aren't really "about" any one particular master.
    val anyToken = masters.firstOrNull()?.token

    LaunchedEffect(masters.toList(), refreshTick) {
        if (masters.isEmpty()) {
            onlineById = emptyMap()
            return@LaunchedEffect
        }
        while (true) {
            val current = Prefs.pairedMasters.toList()
            val results = current.associate { it.id to MasterApi.ping(it.host, it.token) }
            onlineById = results
            delay(PING_INTERVAL_MS)
        }
    }

    // pings this phone's own LocalHttpServer at localhost — if this ever comes back false while paired,
    // device sharing silently isn't running and every paired master will see this phone as Offline no
    // matter what.
    LaunchedEffect(anyToken, refreshTick) {
        if (anyToken == null) {
            sharingActive = null
            return@LaunchedEffect
        }
        val lastAnnouncedHostByMaster = HashMap<String, String>()
        while (true) {
            val active = MasterApi.ping("localhost:$LOCAL_SERVER_PORT", anyToken)
            sharingActive = active
            if (!active) LocalServerService.start(context) // got stopped somehow — bring it back

            // a DHCP lease renewal after sitting locked/idle is enough to change this phone's LAN address —
            // without re-announcing it to EVERY paired master, each one just keeps retrying a dead address
            // until a full re-pair. Skip USB pairings (host is "localhost:<port>" via the adb tunnel, not a
            // real LAN address — announcing a WiFi IP there would break a working tunnel for no reason).
            if (active) {
                val ip = LocalNetwork.lanAddress()
                if (ip != null) {
                    val currentAddress = "$ip:$LOCAL_SERVER_PORT"
                    Prefs.pairedMasters.toList().forEach { master ->
                        val isUsbPairing = master.host.startsWith("localhost:") || master.host.startsWith("127.0.0.1:")
                        if (!isUsbPairing && lastAnnouncedHostByMaster[master.id] != currentAddress) {
                            if (MasterApi.updateHost(master.host, master.token, currentAddress)) {
                                lastAnnouncedHostByMaster[master.id] = currentAddress
                            }
                        }
                    }
                }
            }

            delay(PING_INTERVAL_MS)
        }
    }

    val pairingMessage = PairingStatus.message.value
    LaunchedEffect(pairingMessage) {
        if (pairingMessage != null) {
            delay(4000)
            PairingStatus.message.value = null
        }
    }

    fun unpair(master: PairedMaster) {
        // Clear locally FIRST, notify the paired PC after — this used to await the network call (up to
        // CONNECT_TIMEOUT_MS, 6s) before anything visibly changed, so tapping Unpair while that PC was
        // unreachable (e.g. mid-hotspot-switch) looked like the button just did nothing for several
        // seconds. The user asked to unpair; this phone can't force the other side to agree regardless of
        // ordering, so there's no correctness reason to make them wait on it.
        Prefs.clearPairing(master.id)
        if (!Prefs.isPaired) LocalServerService.stop(context)
        PairingStatus.isError.value = false
        PairingStatus.message.value = "Unpaired from ${master.name}"
        scope.launch {
            val removedOnMaster = MasterApi.unpair(master.host, master.token, Prefs.deviceId)
            if (!removedOnMaster) {
                PairingStatus.isError.value = true
                PairingStatus.message.value = "Unpaired here, but couldn't reach ${master.name} — remove it there too from Devices"
            }
        }
    }

    ScreenScaffold("Devices", onOpenDrawer) {
        ScreenHeader("Devices", "This phone and the Mac or Windows PCs it's paired with.")

        pairingMessage?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = if (PairingStatus.isError.value) LocalAllieMinateColors.current.offline else LocalAllieMinateColors.current.online,
            )
        }

        DeviceCard(
            icon = Icons.Filled.PhoneAndroid,
            name = "This Phone",
            meta = "Android",
            online = true,
            trailing = if (masters.isEmpty()) null else {
                {
                    Text(
                        if (sharingActive == true) "Sharing active" else if (sharingActive == false) "Sharing inactive" else "",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (sharingActive == true) LocalAllieMinateColors.current.online else LocalAllieMinateColors.current.offline,
                    )
                }
            },
        )

        masters.forEach { master ->
            DeviceCard(
                icon = Icons.Filled.Computer,
                name = master.name,
                meta = master.platform,
                online = onlineById[master.id] == true,
                trailing = {
                    TextButton(onClick = { unpair(master) }) {
                        Icon(Icons.Filled.LinkOff, contentDescription = "Unpair", tint = MaterialTheme.colorScheme.error)
                        Text(" Unpair", color = MaterialTheme.colorScheme.error)
                    }
                },
            )
        }

        if (masters.size < Prefs.MAX_PAIRED_MASTERS) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(LocalAllieMinateColors.current.surfaceStrong)
                    .clickable { showPairDialog = true }
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Icon(Icons.Filled.Add, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column {
                    Text(
                        if (masters.isEmpty()) "Pair a device" else "Pair another device (${masters.size}/${Prefs.MAX_PAIRED_MASTERS})",
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                    )
                    Text("Same WiFi network as your Mac or Windows PC", style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary)
                }
            }
        }
    }

    if (showPairDialog) {
        PairDeviceDialog(
            onDismiss = { showPairDialog = false },
            onPaired = {
                showPairDialog = false
                refreshTick++
                LocalServerService.start(context)
            },
        )
    }
}

@Composable
private fun DeviceCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    name: String,
    meta: String,
    online: Boolean,
    trailing: (@Composable () -> Unit)? = null,
) {
    val colors = LocalAllieMinateColors.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(colors.surfaceStrong)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (meta.isNotBlank()) Text(meta, style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceSecondary)
                Text(
                    if (online) "Online" else "Offline",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (online) colors.online else colors.offline,
                )
            }
        }
        trailing?.invoke()
    }
}
