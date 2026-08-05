package com.alliminate.android.data

import com.alliminate.android.service.LOCAL_SERVER_PORT
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

private const val CONNECT_TIMEOUT_MS = 6000
private const val READ_TIMEOUT_MS = 15000
// large transfers (up to the 5GB cap) can legitimately take minutes over real-world WiFi — this only
// bounds how long a single blocking read/write call can stall, not the whole transfer.
private const val UPLOAD_READ_TIMEOUT_MS = 120_000
private const val STREAM_CHUNK_BYTES = 64 * 1024

/** Talks to a paired Master Device's AllieMinate backend over LAN — same REST routes the desktop
 * renderer already calls, same Bearer-token scheme pairing.ts/server.ts already enforce for non-loopback
 * requests. No new backend protocol, just an Android client for the existing one. */
object MasterApi {

    private fun httpUrl(host: String, path: String) = URL("http://$host$path")

    private fun request(url: URL, method: String, token: String?, jsonBody: JSONObject?): Pair<Int, String> {
        val conn = url.openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            if (jsonBody != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(jsonBody.toString().toByteArray()) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return code to body
        } finally {
            conn.disconnect()
        }
    }

    private fun errorMessage(body: String, fallback: String): String {
        return try {
            JSONObject(body).optString("error").ifBlank { fallback }
        } catch (_: Exception) {
            fallback
        }
    }

    suspend fun pairVerify(host: String, code: String): ApiResult<PairResult> = withContext(Dispatchers.IO) {
        try {
            // a scanned QR encoding "localhost:4310" means this is a USB pairing (adb reverse tunneled the
            // Mac's own loopback to the phone) — report ourselves back at "localhost:<port>" too, so the
            // Mac's future requests to us go through the matching `adb forward` tunnel instead of a LAN IP
            // that doesn't apply over USB.
            val isUsb = host.startsWith("localhost:") || host.startsWith("127.0.0.1:")
            val lanAddress = if (isUsb) {
                "localhost:$LOCAL_SERVER_PORT"
            } else {
                LocalNetwork.lanAddress()?.let { ip -> "$ip:$LOCAL_SERVER_PORT" } ?: ""
            }
            val requester = JSONObject().apply {
                put("id", Prefs.deviceId)
                put("name", Prefs.deviceName)
                put("platform", "android")
                put("host", lanAddress) // LocalHttpServer listens here — empty only if no WiFi IP could be found
            }
            val body = JSONObject().apply {
                put("code", code)
                put("requester", requester)
            }
            val (status, text) = request(httpUrl(host, "/pair/verify"), "POST", null, body)
            if (status !in 200..299) return@withContext ApiResult.Err(errorMessage(text, "pairing failed ($status)"))

            val json = JSONObject(text)
            ApiResult.Ok(
                PairResult(
                    id = json.getString("id"),
                    name = json.getString("name"),
                    platform = json.getString("platform"),
                    token = json.getString("token"),
                ),
            )
        } catch (err: IOException) {
            ApiResult.Err(err.message ?: "couldn't reach $host")
        } catch (err: Exception) {
            ApiResult.Err(err.message ?: "unexpected error")
        }
    }

    /** USB confirm screen's "No" — reachable without a token since pairing hasn't happened yet, same as
     * pairVerify. */
    suspend fun rejectPair(host: String, code: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject().apply { put("code", code) }
            val (status, _) = request(httpUrl(host, "/pair/reject"), "POST", null, body)
            status in 200..299
        } catch (_: Exception) {
            false
        }
    }

    /** Keeps the Mac's paired-device record pointed at this phone's real current LAN address — a DHCP
     * lease renewal after sitting locked/idle for a few minutes is enough to change it, and without this
     * the Mac just keeps retrying a dead address forever (the only recovery used to be a full unpair +
     * re-pair, which just re-learns the address once and drifts again later). */
    suspend fun updateHost(host: String, token: String, newHost: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val body = JSONObject().apply { put("host", newHost) }
            val (status, _) = request(httpUrl(host, "/devices/self/host"), "POST", token, body)
            status in 200..299
        } catch (_: Exception) {
            false
        }
    }

    suspend fun ping(host: String, token: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val (status, _) = request(httpUrl(host, "/status"), "GET", token, null)
            status in 200..299
        } catch (_: Exception) {
            false
        }
    }

    suspend fun listProviders(host: String, token: String): ApiResult<List<String>> = withContext(Dispatchers.IO) {
        try {
            val (status, text) = request(httpUrl(host, "/status"), "GET", token, null)
            if (status !in 200..299) return@withContext ApiResult.Err(errorMessage(text, "server returned $status"))
            val arr = JSONObject(text).getJSONArray("providers")
            ApiResult.Ok((0 until arr.length()).map { arr.getString(it) })
        } catch (err: Exception) {
            ApiResult.Err(err.message ?: "couldn't reach Master")
        }
    }

    /** Master's pinned folders — same list the desktop tray reads for "Save to Cloud", filtered to real
     * pinned destinations (remotePrefix "*" is the whole-account library view, not a place to upload to). */
    suspend fun folders(host: String, token: String): ApiResult<List<RemoteFolder>> = withContext(Dispatchers.IO) {
        try {
            val (status, text) = request(httpUrl(host, "/status"), "GET", token, null)
            if (status !in 200..299) return@withContext ApiResult.Err(errorMessage(text, "server returned $status"))
            val arr = JSONObject(text).getJSONArray("folders")
            val folders = (0 until arr.length()).map { arr.getJSONObject(it) }
                .filter { it.optString("remotePrefix") != "*" }
                .map { RemoteFolder(it.getString("id"), it.getString("name"), it.getString("provider")) }
            ApiResult.Ok(folders)
        } catch (err: Exception) {
            ApiResult.Err(err.message ?: "couldn't reach Master")
        }
    }

    /** Camera Backup's destination is a real cloud SERVICE (chosen in Settings), not a pinned-folder
     * config — targets the same /providers/:id/upload route the Finder-style desktop picker and
     * ShareScreen use. Photos are small enough that buffering here (unlike ShareScreen's user-picked
     * files, which can be multi-GB) is fine. */
    suspend fun uploadBytesToProvider(host: String, token: String, providerId: String, name: String, bytes: ByteArray): ApiResult<Unit> =
        withContext(Dispatchers.IO) {
            val conn = httpUrl(host, "/providers/$providerId/upload?name=${URLEncoder.encode(name, "UTF-8")}")
                .openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = CONNECT_TIMEOUT_MS
                conn.readTimeout = UPLOAD_READ_TIMEOUT_MS
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Content-Type", "application/octet-stream")
                conn.outputStream.use { it.write(bytes) }
                val status = conn.responseCode
                if (status !in 200..299) {
                    val text = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    return@withContext ApiResult.Err(errorMessage(text, "upload failed ($status)"))
                }
                ApiResult.Ok(Unit)
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            } finally {
                conn.disconnect()
            }
        }

    suspend fun uploadBytes(host: String, token: String, folderId: String, name: String, bytes: ByteArray): ApiResult<Unit> =
        withContext(Dispatchers.IO) {
            val conn = httpUrl(host, "/folders/$folderId/upload?name=${URLEncoder.encode(name, "UTF-8")}")
                .openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = CONNECT_TIMEOUT_MS
                conn.readTimeout = 60_000
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Content-Type", "application/octet-stream")
                conn.outputStream.use { it.write(bytes) }
                val status = conn.responseCode
                if (status !in 200..299) {
                    val text = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    return@withContext ApiResult.Err(errorMessage(text, "upload failed ($status)"))
                }
                ApiResult.Ok(Unit)
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            } finally {
                conn.disconnect()
            }
        }

    /** "Send to Connected Devices" from the share-sheet — lands directly in the Master Device's own
     * Downloads folder, distinct from uploadBytes() which targets an AllieMinate-managed cloud folder. */
    suspend fun uploadToInbox(host: String, token: String, name: String, bytes: ByteArray): ApiResult<Unit> =
        withContext(Dispatchers.IO) {
            val conn = httpUrl(host, "/inbox/upload?name=${URLEncoder.encode(name, "UTF-8")}&from=${URLEncoder.encode(Prefs.deviceName, "UTF-8")}")
                .openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = CONNECT_TIMEOUT_MS
                conn.readTimeout = 60_000
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Content-Type", "application/octet-stream")
                conn.outputStream.use { it.write(bytes) }
                val status = conn.responseCode
                if (status !in 200..299) {
                    val text = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    return@withContext ApiResult.Err(errorMessage(text, "send failed ($status)"))
                }
                ApiResult.Ok(Unit)
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            } finally {
                conn.disconnect()
            }
        }

    /** Manual copy loop instead of InputStream.copyTo() so callers can get live byte-count progress —
     * copyTo() has no progress hook, and it's the only reason not to use it here. */
    private fun copyWithProgress(input: InputStream, out: java.io.OutputStream, onProgress: ((Long) -> Unit)?) {
        val buffer = ByteArray(STREAM_CHUNK_BYTES)
        var sent = 0L
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            out.write(buffer, 0, n)
            sent += n
            onProgress?.invoke(sent)
        }
    }

    /** Streams straight from the picked file's InputStream into the HTTP body via chunked transfer encoding
     * — never buffers the whole file in memory, so a multi-GB video doesn't blow the heap the way reading
     * it into a ByteArray first does. Targets a real cloud SERVICE (not a pinned-folder config) via the
     * provider-tree upload route added for the desktop Finder-style picker. `onProgress` (bytes sent so
     * far) powers the Android notification progress bar during large sends. */
    suspend fun uploadStreamToProvider(
        host: String,
        token: String,
        providerId: String,
        name: String,
        input: InputStream,
        onProgress: ((Long) -> Unit)? = null,
        folderId: String? = null,
    ): ApiResult<Unit> =
        withContext(Dispatchers.IO) {
            val folderQs = if (folderId != null) "&folderId=${URLEncoder.encode(folderId, "UTF-8")}" else ""
            val conn = httpUrl(host, "/providers/$providerId/upload?name=${URLEncoder.encode(name, "UTF-8")}$folderQs")
                .openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = CONNECT_TIMEOUT_MS
                conn.readTimeout = UPLOAD_READ_TIMEOUT_MS
                conn.setChunkedStreamingMode(STREAM_CHUNK_BYTES)
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Content-Type", "application/octet-stream")
                conn.outputStream.use { out -> input.use { copyWithProgress(it, out, onProgress) } }
                val status = conn.responseCode
                if (status !in 200..299) {
                    val text = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    return@withContext ApiResult.Err(errorMessage(text, "upload failed ($status)"))
                }
                ApiResult.Ok(Unit)
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            } finally {
                conn.disconnect()
            }
        }

    /** Streaming counterpart to uploadToInbox() — same "Send to Connected Devices" destination, but reads
     * the file straight off disk instead of buffering it fully first. */
    suspend fun uploadStreamToInbox(
        host: String,
        token: String,
        name: String,
        input: InputStream,
        onProgress: ((Long) -> Unit)? = null,
    ): ApiResult<Unit> =
        withContext(Dispatchers.IO) {
            val conn = httpUrl(host, "/inbox/upload?name=${URLEncoder.encode(name, "UTF-8")}&from=${URLEncoder.encode(Prefs.deviceName, "UTF-8")}")
                .openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = CONNECT_TIMEOUT_MS
                conn.readTimeout = UPLOAD_READ_TIMEOUT_MS
                conn.setChunkedStreamingMode(STREAM_CHUNK_BYTES)
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Content-Type", "application/octet-stream")
                conn.outputStream.use { out -> input.use { copyWithProgress(it, out, onProgress) } }
                val status = conn.responseCode
                if (status !in 200..299) {
                    val text = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    return@withContext ApiResult.Err(errorMessage(text, "send failed ($status)"))
                }
                ApiResult.Ok(Unit)
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            } finally {
                conn.disconnect()
            }
        }

    suspend fun accounts(host: String, token: String): ApiResult<List<AccountInfo>> = withContext(Dispatchers.IO) {
        try {
            val (status, text) = request(httpUrl(host, "/accounts"), "GET", token, null)
            if (status !in 200..299) return@withContext ApiResult.Err(errorMessage(text, "server returned $status"))
            val arr = JSONObject(text).getJSONArray("accounts")
            ApiResult.Ok(
                (0 until arr.length()).map {
                    val a = arr.getJSONObject(it)
                    AccountInfo(a.getString("accountId"), a.getString("label"), a.getString("provider"))
                },
            )
        } catch (err: Exception) {
            ApiResult.Err(err.message ?: "couldn't reach Master")
        }
    }

    suspend fun browseProvider(host: String, token: String, providerId: String): ApiResult<List<RemoteFile>> =
        withContext(Dispatchers.IO) {
            try {
                val (status, text) = request(httpUrl(host, "/providers/$providerId/browse"), "GET", token, null)
                if (status !in 200..299) return@withContext ApiResult.Err(errorMessage(text, "server returned $status"))
                val arr: JSONArray = JSONObject(text).getJSONArray("files")
                ApiResult.Ok(
                    (0 until arr.length()).map {
                        val f = arr.getJSONObject(it)
                        RemoteFile(
                            path = f.getString("path"),
                            size = f.optLong("size", 0L),
                            modifiedAt = f.optString("modifiedAt"),
                            mimeType = f.optString("mimeType").ifBlank { null },
                            thumbnailUrl = f.optString("thumbnailUrl").ifBlank { null },
                        )
                    },
                )
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            }
        }

    // Finder-style folder tree, one level at a time — mirrors the desktop UploadModal's own picker exactly
    // (same /providers/:id/tree route, same folderId-omitted-means-top-level convention). Used by
    // CloudServicesScreen's account browser so folders actually navigate instead of every file in the
    // account showing up flattened into one list regardless of what folder it's really in.
    suspend fun browseTree(host: String, token: String, providerId: String, folderId: String?): ApiResult<TreeResult> =
        withContext(Dispatchers.IO) {
            try {
                val qs = if (folderId != null) "?folderId=${URLEncoder.encode(folderId, "UTF-8")}" else ""
                val (status, text) = request(httpUrl(host, "/providers/$providerId/tree$qs"), "GET", token, null)
                if (status !in 200..299) return@withContext ApiResult.Err(errorMessage(text, "server returned $status"))
                val obj = JSONObject(text)
                val folderArr = obj.optJSONArray("folders") ?: JSONArray()
                val fileArr = obj.optJSONArray("files") ?: JSONArray()
                ApiResult.Ok(
                    TreeResult(
                        folders = (0 until folderArr.length()).map {
                            val f = folderArr.getJSONObject(it)
                            TreeFolderNode(id = f.getString("id"), name = f.getString("name"))
                        },
                        files = (0 until fileArr.length()).map {
                            val f = fileArr.getJSONObject(it)
                            RemoteFile(
                                path = f.getString("path"),
                                size = f.optLong("size", 0L),
                                modifiedAt = f.optString("modifiedAt"),
                                mimeType = f.optString("mimeType").ifBlank { null },
                                thumbnailUrl = f.optString("thumbnailUrl").ifBlank { null },
                            )
                        },
                    ),
                )
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            }
        }

    // Deleting a Sync Pair used to just forget the pair locally, leaving every file it ever pushed sitting
    // in the cloud folder forever with no way to tell which files came from a since-deleted pair. Called
    // right before the pair's local state is cleared, while the exact list of pushed filenames still exists.
    suspend fun trashMany(host: String, token: String, providerId: String, keys: List<String>): ApiResult<Unit> =
        withContext(Dispatchers.IO) {
            try {
                val body = JSONObject().apply {
                    put("providerId", providerId)
                    put("keys", JSONArray(keys))
                }
                val (status, text) = request(httpUrl(host, "/files/trash-many"), "POST", token, body)
                if (status !in 200..299) return@withContext ApiResult.Err(errorMessage(text, "server returned $status"))
                ApiResult.Ok(Unit)
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            }
        }

    suspend fun createFolder(host: String, token: String, providerId: String, parentId: String?, name: String): ApiResult<TreeFolderNode> =
        withContext(Dispatchers.IO) {
            try {
                val body = JSONObject().apply {
                    put("name", name)
                    if (parentId != null) put("parentId", parentId)
                }
                val (status, text) = request(httpUrl(host, "/providers/$providerId/folders"), "POST", token, body)
                if (status !in 200..299) return@withContext ApiResult.Err(errorMessage(text, "server returned $status"))
                val folder = JSONObject(text).getJSONObject("folder")
                ApiResult.Ok(TreeFolderNode(id = folder.getString("id"), name = folder.getString("name")))
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            }
        }

    // Phase 4: Cross-Device Search — the Mac does all the fan-out (every cloud provider + every online
    // paired device); this phone just asks and renders. Same "search" for whichever device is asking.
    suspend fun search(host: String, token: String, query: String): ApiResult<List<SearchResult>> =
        withContext(Dispatchers.IO) {
            try {
                val (status, text) = request(httpUrl(host, "/search?q=${URLEncoder.encode(query, "UTF-8")}"), "GET", token, null)
                if (status !in 200..299) return@withContext ApiResult.Err(errorMessage(text, "server returned $status"))
                val arr: JSONArray = JSONObject(text).getJSONArray("results")
                ApiResult.Ok(
                    (0 until arr.length()).map {
                        val r = arr.getJSONObject(it)
                        SearchResult(
                            source = r.getString("source"),
                            sourceLabel = r.optString("sourceLabel"),
                            providerId = r.optString("providerId").ifBlank { null },
                            deviceId = r.optString("deviceId").ifBlank { null },
                            folderId = r.optString("folderId").ifBlank { null },
                            path = r.getString("path"),
                            size = r.optLong("size", 0L),
                            modifiedAt = r.optString("modifiedAt"),
                            mimeType = r.optString("mimeType").ifBlank { null },
                        )
                    },
                )
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            }
        }

    // A 'device' search result names a file on ANOTHER paired device, not on the Mac itself — the Mac
    // proxies the download the same way it already does for the desktop Devices browser.
    suspend fun downloadDeviceFile(host: String, token: String, deviceId: String, folderId: String, key: String): ApiResult<ByteArray> =
        withContext(Dispatchers.IO) {
            val conn = httpUrl(host, "/devices/$deviceId/folders/$folderId/download?key=${URLEncoder.encode(key, "UTF-8")}")
                .openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "GET"
                conn.connectTimeout = CONNECT_TIMEOUT_MS
                conn.readTimeout = 60_000
                conn.setRequestProperty("Authorization", "Bearer $token")
                val status = conn.responseCode
                if (status !in 200..299) {
                    val text = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    return@withContext ApiResult.Err(errorMessage(text, "download failed ($status)"))
                }
                ApiResult.Ok(conn.inputStream.use { it.readBytes() })
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            } finally {
                conn.disconnect()
            }
        }

    suspend fun downloadBytes(host: String, token: String, providerId: String, key: String): ApiResult<ByteArray> =
        withContext(Dispatchers.IO) {
            val conn = httpUrl(host, "/providers/$providerId/download?key=${URLEncoder.encode(key, "UTF-8")}")
                .openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "GET"
                conn.connectTimeout = CONNECT_TIMEOUT_MS
                conn.readTimeout = 60_000
                conn.setRequestProperty("Authorization", "Bearer $token")
                val status = conn.responseCode
                if (status !in 200..299) {
                    val text = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
                    return@withContext ApiResult.Err(errorMessage(text, "download failed ($status)"))
                }
                ApiResult.Ok(conn.inputStream.use { it.readBytes() })
            } catch (err: Exception) {
                ApiResult.Err(err.message ?: "couldn't reach Master")
            } finally {
                conn.disconnect()
            }
        }

    fun downloadUrl(host: String, providerId: String, key: String): String =
        httpUrl(host, "/providers/$providerId/download?key=${URLEncoder.encode(key, "UTF-8")}").toString()

    suspend fun unpair(host: String, token: String, deviceId: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val (status, _) = request(httpUrl(host, "/devices/$deviceId"), "DELETE", token, null)
            status in 200..299
        } catch (_: Exception) {
            false
        }
    }
}
