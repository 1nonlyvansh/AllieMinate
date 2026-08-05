package com.alliminate.android.ui.components

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.Prefs
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Phones pair by scanning the QR code AllieMinate for Mac shows (Devices → Pair an Android) — no typed
 * host/code. Manual host:port + code entry is a Mac/Windows-only flow (the desktop's own PairDeviceModal),
 * since a phone's camera makes QR strictly easier and less error-prone than transcribing a 6-digit code
 * and an IP address by hand. */
@Composable
fun PairDeviceDialog(onDismiss: () -> Unit, onPaired: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val raw = result.contents ?: return@rememberLauncherForActivityResult
        error = null
        busy = true
        scope.launch {
            val parsed = runCatching {
                val json = JSONObject(raw)
                json.getString("host") to json.getString("code")
            }.getOrNull()
            if (parsed == null) {
                busy = false
                error = "That QR code isn't an AllieMinate pairing code"
                return@launch
            }
            val (host, code) = parsed
            when (val pairResult = MasterApi.pairVerify(host, code)) {
                is ApiResult.Ok -> {
                    Prefs.savePairing(host, pairResult.value.token, pairResult.value.name, pairResult.value.platform, pairResult.value.id)
                    busy = false
                    onPaired()
                }
                is ApiResult.Err -> {
                    busy = false
                    error = pairResult.message
                }
            }
        }
    }

    fun startScan() {
        scanLauncher.launch(
            ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Point at the QR code shown in AllieMinate for Mac → Devices → Pair an Android")
                .setBeepEnabled(false)
                .setOrientationLocked(true),
        )
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Pair with a Mac or Windows PC") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "On AllieMinate for Mac, open Devices → Pair an Android, then scan the QR code it shows.",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (busy) {
                    CircularProgressIndicator()
                } else {
                    Button(onClick = ::startScan, modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Filled.QrCodeScanner, contentDescription = null)
                        Text("  Scan QR Code")
                    }
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
