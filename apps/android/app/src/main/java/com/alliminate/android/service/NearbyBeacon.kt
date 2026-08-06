package com.alliminate.android.service

import com.alliminate.android.data.Prefs
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress

private const val NEARBY_PORT = 41310
private const val BEACON_INTERVAL_MS = 3000L
private const val LISTEN_SOCKET_TIMEOUT_MS = 2000

// plain UDP broadcast, matching the Mac backend's nearbyDiscovery.ts exactly (same port, same payload
// shape). Two independent jobs share this file: SENDING our own presence (Nearby Share — gated on the
// nearbyShareEnabled toggle, since that's what makes this phone discoverable to strangers for ad-hoc
// sharing) and LISTENING for the Master's beacon (hotspot/network-change reconnect — NOT gated on that
// toggle, since it doesn't reveal anything about us, just lets us hear what's already being broadcast).
object NearbyBeacon {
    private var sendThread: Thread? = null
    private var listenThread: Thread? = null

    @Volatile
    private var running = false

    @Volatile
    private var listening = false

    fun start() {
        if (running) return
        running = true
        sendThread = Thread {
            val socket = runCatching { DatagramSocket().apply { broadcast = true } }.getOrNull()
            if (socket == null) {
                running = false
                return@Thread
            }
            try {
                while (running) {
                    if (Prefs.nearbyShareEnabled.value) {
                        val payload = JSONObject().apply {
                            put("type", "alliminate-nearby")
                            put("id", Prefs.deviceId)
                            put("name", Prefs.deviceName)
                            put("platform", "android")
                            put("port", LOCAL_SERVER_PORT)
                            put("nearbyShareEnabled", true)
                        }.toString().toByteArray()
                        runCatching {
                            socket.send(DatagramPacket(payload, payload.size, InetAddress.getByName("255.255.255.255"), NEARBY_PORT))
                        }
                    }
                    Thread.sleep(BEACON_INTERVAL_MS)
                }
            } finally {
                socket.close()
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running = false
        sendThread = null
    }

    /** Hears a paired PC's own periodic beacon (nearbyDiscovery.ts's setInterval broadcast — needs Nearby
     * Share enabled on that PC, same as this phone's send loop needs it locally) and self-heals that one
     * paired master's stale host the moment the phone lands on a new network it's also reachable on —
     * mirrors the desktop backend's isOnline() fallback (devices.ts) that does the same thing in reverse.
     * Independent of the send loop: runs whenever paired, regardless of this phone's own discoverability. */
    fun startListening() {
        if (listening) return
        listening = true
        listenThread = Thread {
            val socket = runCatching {
                DatagramSocket(null).apply {
                    reuseAddress = true
                    soTimeout = LISTEN_SOCKET_TIMEOUT_MS
                    bind(InetSocketAddress(NEARBY_PORT))
                }
            }.getOrNull()
            if (socket == null) {
                listening = false
                return@Thread
            }
            val buf = ByteArray(2048)
            try {
                while (listening) {
                    val packet = DatagramPacket(buf, buf.size)
                    val received = runCatching {
                        socket.receive(packet)
                        true
                    }.getOrElse { false } // covers the timeout exception too — just loop and check `listening` again
                    if (!received) continue

                    runCatching {
                        val data = JSONObject(String(packet.data, 0, packet.length))
                        if (data.optString("type") != "alliminate-nearby") return@runCatching
                        val beaconId = data.optString("id", "")
                        val master = Prefs.masterById(beaconId) ?: return@runCatching

                        val port = data.optInt("port", 0)
                        if (port <= 0) return@runCatching
                        val newHost = "${packet.address.hostAddress}:$port"
                        if (newHost != master.host) Prefs.updateMasterHost(master.id, newHost)
                    }
                }
            } finally {
                socket.close()
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    fun stopListening() {
        listening = false
        listenThread = null
    }
}
