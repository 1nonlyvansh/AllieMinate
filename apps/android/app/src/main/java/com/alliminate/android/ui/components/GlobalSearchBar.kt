package com.alliminate.android.ui.components

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.Downloads
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.SearchResult
import com.alliminate.android.ui.theme.LocalAllieMinateColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val SEARCH_DEBOUNCE_MS = 350L

/** Phase 4: Cross-Device Search — the Mac does all the fan-out (every cloud provider + every online
 * paired device); this phone just asks GET /search and renders. Tapping a result downloads it fresh
 * (through the Mac, same as any other remote file this phone opens) and opens it. */
@Composable
fun GlobalSearchBar(host: String, token: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchResult>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var downloadingPath by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(query) {
        if (query.isBlank()) {
            results = emptyList()
            loading = false
            return@LaunchedEffect
        }
        loading = true
        delay(SEARCH_DEBOUNCE_MS)
        when (val r = MasterApi.search(host, token, query)) {
            is ApiResult.Ok -> results = r.value
            is ApiResult.Err -> results = emptyList()
        }
        loading = false
    }

    fun openResult(result: SearchResult) {
        downloadingPath = result.path
        scope.launch {
            val apiResult = if (result.source == "device" && result.deviceId != null && result.folderId != null) {
                MasterApi.downloadDeviceFile(host, token, result.deviceId, result.folderId, result.path)
            } else {
                MasterApi.downloadBytes(host, token, result.providerId ?: "", result.path)
            }
            downloadingPath = null
            when (apiResult) {
                is ApiResult.Ok -> {
                    val mime = Downloads.guessMimeType(result.displayName, result.mimeType)
                    val uri = Downloads.save(context, result.displayName, mime, apiResult.value)
                    if (uri != null) {
                        val openIntent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(uri, mime)
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                        }
                        runCatching { context.startActivity(openIntent) }
                    }
                }
                is ApiResult.Err -> Toast.makeText(context, "Couldn't get \"${result.displayName}\": ${apiResult.message}", Toast.LENGTH_LONG).show()
            }
        }
    }

    Column(modifier = Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Search across every cloud & device…") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(),
        )

        if (query.isNotBlank()) {
            GlassCard(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                if (loading) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        CircularProgressIndicator(modifier = Modifier.padding(bottom = 4.dp))
                        Text("Searching…", style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary)
                    }
                } else if (results.isEmpty()) {
                    Text(
                        "No matches",
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = LocalAllieMinateColors.current.onSurfaceSecondary,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        results.forEach { result ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable(enabled = downloadingPath == null) { openResult(result) }
                                    .padding(PaddingValues(horizontal = 16.dp, vertical = 10.dp)),
                            ) {
                                Text(result.displayName, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    (if (result.source == "device") "📱 " else "☁️ ") + result.sourceLabel +
                                        if (downloadingPath == result.path) " · Getting…" else "",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = LocalAllieMinateColors.current.onSurfaceTertiary,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
