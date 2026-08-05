package com.alliminate.android.service

/** Phase 3: Phone as Remote Unlock/Approve — receiver side (this phone is almost always the approver, not
 * the one being unlocked). Mirrors NearbyShareRegistry's shape, but the SENDER (the locked Mac) mints the
 * request id, not this phone — the Mac needs one id to poll against every paired device it broadcast to.
 * This only ever gates AllieMinate's own in-app App Lock on the Mac; it has no path to the OS's actual
 * login/lock screen. */
enum class UnlockRequestStatus { PENDING, ACCEPTED, DECLINED, EXPIRED }

data class UnlockRequest(
    val id: String,
    val fromName: String,
    val status: UnlockRequestStatus,
    val createdAt: Long,
)

private const val UNLOCK_TTL_MS = 90_000L

object UnlockApprovalRegistry {
    private val requests = mutableMapOf<String, UnlockRequest>()

    @Synchronized
    fun create(id: String, fromName: String): UnlockRequest {
        val request = UnlockRequest(id, fromName, UnlockRequestStatus.PENDING, System.currentTimeMillis())
        requests[id] = request
        return request
    }

    @Synchronized
    fun get(id: String): UnlockRequest? {
        val request = requests[id] ?: return null
        if (request.status == UnlockRequestStatus.PENDING && System.currentTimeMillis() - request.createdAt > UNLOCK_TTL_MS) {
            val expired = request.copy(status = UnlockRequestStatus.EXPIRED)
            requests[id] = expired
            return expired
        }
        return request
    }

    @Synchronized
    fun respond(id: String, accept: Boolean): UnlockRequest? {
        val request = get(id) ?: return null
        if (request.status != UnlockRequestStatus.PENDING) return null
        val updated = request.copy(status = if (accept) UnlockRequestStatus.ACCEPTED else UnlockRequestStatus.DECLINED)
        requests[id] = updated
        return updated
    }
}
