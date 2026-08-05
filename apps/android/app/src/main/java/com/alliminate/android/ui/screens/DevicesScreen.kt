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
    var masterOnline by remember { mutableStateOf<Boolean?>(null) }
    var sharingActive by remember { mutableStateOf<Boolean?>(null) }
    var refreshTick by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val host = Prefs.masterHost.value
    val token = Prefs.masterToken.value
    val name = Prefs.masterName.value
    val platform = Prefs.masterPlatform.value

    LaunchedEffect(host, token, refreshTick) {
        if (host == null || token == null) {
            masterOnline = null
            return@LaunchedEffect
        }
        while (true) {
            masterOnline = MasterApi.ping(host, token)
            delay(PING_INTERVAL_MS)
        }
    }

    // pings this phone's own LocalHttpServer at localhost — if this ever comes back false while paired,
    // device sharing silently isn't running and the Master will see this phone as Offline no matter what.
    LaunchedEffect(token, refreshTick) {
        if (token == null) {
            sharingActive = null
            return@LaunchedEffect
        }
        var lastAnnouncedHost: String? = null
        while (true) {
            val active = MasterApi.ping("localhost:$LOCAL_SERVER_PORT", token)
            sharingActive = active
            if (!active) LocalServerService.start(context) // got stopped somehow — bring it back

            // a DHCP lease renewal after sitting locked/idle is enough to change this phone's LAN address —
            // without re-announcing it, the Mac just keeps retrying a dead address until a full re-pair.
            // Skip for USB pairings (host is "localhost:<port>" via the adb tunnel, not a real LAN address —
            // announcing a WiFi IP there would break a working tunnel for no reason).
            val masterHost = Prefs.masterHost.value
            val isUsbPairing = masterHost != null && (masterHost.startsWith("localhost:") || masterHost.startsWith("127.0.0.1:"))
            if (active && masterHost != null && !isUsbPairing) {
                val ip = LocalNetwork.lanAddress()
                if (ip != null) {
                    val currentAddress = "$ip:$LOCAL_SERVER_PORT"
                    if (currentAddress != lastAnnouncedHost) {
                        if (MasterApi.updateHost(masterHost, token, currentAddress)) lastAnnouncedHost = currentAddress
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

    ScreenScaffold("Devices", onOpenDrawer) {
        ScreenHeader("Devices", "This phone and the Mac or Windows PC it's paired with.")

        pairingMessage?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = if (PairingStatus.isError.value) LocalAllieMinateColors.current.offline else LocalAllieMinateColors.current.online,
            )
        }

        val isPaired = host != null && token != null

        DeviceCard(
            icon = Icons.Filled.PhoneAndroid,
            name = "This Phone",
            meta = "Android",
            online = true,
            trailing = if (!isPaired) null else {
                {
                    Text(
                        if (sharingActive == true) "Sharing active" else if (sharingActive == false) "Sharing inactive" else "",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (sharingActive == true) LocalAllieMinateColors.current.online else LocalAllieMinateColors.current.offline,
                    )
                }
            },
        )

        if (isPaired) {
            val pairedHost = requireNotNull(host)
            val pairedToken = requireNotNull(token)
            DeviceCard(
                icon = Icons.Filled.Computer,
                name = name ?: "Master Device",
                meta = platform ?: "",
                online = masterOnline == true,
                trailing = {
                    TextButton(onClick = {
                        scope.launch {
                            val removedOnMaster = MasterApi.unpair(pairedHost, pairedToken, Prefs.deviceId)
                            // clear locally either way — the user asked to unpair, and this phone can't
                            // force the Mac to agree. If the Mac call failed, tell them so it doesn't look
                            // like a clean unpair happened on both ends (that mismatch is exactly what
                            // left stale phone entries showing up on the Mac before).
                            Prefs.clearPairing()
                            LocalServerService.stop(context)
                            PairingStatus.isError.value = !removedOnMaster
                            PairingStatus.message.value = if (removedOnMaster) {
                                "Unpaired"
                            } else {
                                "Unpaired here, but couldn't reach your Mac — remove it there too from Devices"
                            }
                        }
                    }) {
                        Icon(Icons.Filled.LinkOff, contentDescription = "Unpair", tint = MaterialTheme.colorScheme.error)
                        Text(" Unpair", color = MaterialTheme.colorScheme.error)
                    }
                },
            )
        } else {
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
                    Text("Pair a device", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
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
