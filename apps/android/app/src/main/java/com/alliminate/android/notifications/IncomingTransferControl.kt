package com.alliminate.android.notifications

import java.util.concurrent.atomic.AtomicBoolean

/** Shared cancellation flag the receiving read loop (LocalHttpServer.handleUpload) polls, set by the
 * notification's Stop action via StopTransferReceiver — the only way to interrupt an in-progress HTTP
 * request body read from outside the request-handling thread itself. */
object IncomingTransferControl {
    val cancelled = AtomicBoolean(false)
}
