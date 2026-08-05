package com.alliminate.android.data

import java.net.Inet4Address
import java.net.NetworkInterface

/** Best-guess LAN-reachable IPv4 address for this phone — same technique the desktop backend already
 * uses in device.ts's getLanAddress(), so the Master Device can reach this phone's LocalHttpServer.
 * Prefers a "wlan"-named interface explicitly — on a phone with multiple "up" interfaces (VPN, mobile
 * data, USB tethering) the first non-loopback IPv4 found isn't reliably the WiFi one, and pairing only
 * makes sense over WiFi to begin with. */
object LocalNetwork {
    fun lanAddress(): String? {
        return runCatching {
            val interfaces = NetworkInterface.getNetworkInterfaces().asSequence()
                .filter { !it.isLoopback && it.isUp }
                .toList()

            val wifiFirst = interfaces.sortedByDescending { it.name.startsWith("wlan") }

            wifiFirst.asSequence()
                .flatMap { it.inetAddresses.asSequence() }
                .filterIsInstance<Inet4Address>()
                .firstOrNull { !it.isLoopbackAddress }
                ?.hostAddress
        }.getOrNull()
    }
}
