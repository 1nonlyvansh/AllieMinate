package com.alliminate.android.service

import java.util.UUID

enum class NearbyRequestStatus { PENDING, ACCEPTED, DECLINED, EXPIRED }

data class NearbyIncomingRequest(
    val id: String,
    val fromName: String,
    val fileName: String,
    val fileSize: Long,
    var status: NearbyRequestStatus,
    val createdAt: Long,
)

// mirrors the backend's nearbyTransfer.ts — a sender discovered via UDP has no pre-shared token, so this
// tracks the accept/decline consent per transfer instead of relying on persistent pairing trust.
object NearbyShareRegistry {
    private const val TTL_MS = 2 * 60 * 1000L
    private val requests = HashMap<String, NearbyIncomingRequest>()

    @Synchronized
    fun create(fromName: String, fileName: String, fileSize: Long): NearbyIncomingRequest {
        val id = UUID.randomUUID().toString()
        val request = NearbyIncomingRequest(id, fromName, fileName, fileSize, NearbyRequestStatus.PENDING, System.currentTimeMillis())
        requests[id] = request
        return request
    }

    @Synchronized
    fun get(id: String): NearbyIncomingRequest? {
        val request = requests[id] ?: return null
        if (request.status == NearbyRequestStatus.PENDING && System.currentTimeMillis() - request.createdAt > TTL_MS) {
            request.status = NearbyRequestStatus.EXPIRED
        }
        return request
    }

    @Synchronized
    fun respond(id: String, accept: Boolean): NearbyIncomingRequest? {
        val request = get(id) ?: return null
        if (request.status != NearbyRequestStatus.PENDING) return null
        request.status = if (accept) NearbyRequestStatus.ACCEPTED else NearbyRequestStatus.DECLINED
        return request
    }
}
