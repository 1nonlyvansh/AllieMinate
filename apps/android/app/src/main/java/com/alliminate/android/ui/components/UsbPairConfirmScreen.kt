package com.alliminate.android.ui.components

import android.content.Context
import android.content.ContextWrapper
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.PairRequest
import com.alliminate.android.data.PairingStatus
import com.alliminate.android.data.PendingRoute
import com.alliminate.android.data.Prefs
import com.alliminate.android.service.LocalServerService
import com.alliminate.android.ui.nav.Screen
import com.alliminate.android.ui.theme.LocalAllieMinateColors
import kotlinx.coroutines.launch

private tailrec fun Context.findFragmentActivity(): FragmentActivity? = when (this) {
    is FragmentActivity -> this
    is ContextWrapper -> baseContext.findFragmentActivity()
    else -> null
}

/** Reached via the USB pairing deep link — a real Yes/No + fingerprint gate instead of pairing the
 * instant the phone gets a deep link, since a plugged-in cable alone isn't consent. */
@Composable
fun UsbPairConfirmScreen(request: PairRequest, onHandled: () -> Unit) {
    val context = LocalContext.current
    val activity = remember(context) { context.findFragmentActivity() }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun doPair() {
        busy = true
        scope.launch {
            when (val result = MasterApi.pairVerify(request.host, request.code)) {
                is ApiResult.Ok -> {
                    val accepted = Prefs.savePairing(request.host, result.value.token, result.value.name, result.value.platform, result.value.id)
                    busy = false
                    if (!accepted) {
                        error = "Already paired with ${Prefs.MAX_PAIRED_MASTERS} PCs — unpair one first"
                        return@launch
                    }
                    LocalServerService.start(context)
                    PairingStatus.isError.value = false
                    PairingStatus.message.value = "Paired with ${result.value.name}"
                    PendingRoute.route.value = Screen.Devices.route
                    onHandled()
                }
                is ApiResult.Err -> {
                    busy = false
                    error = result.message
                }
            }
        }
    }

    fun confirmWithBiometric() {
        val fa = activity ?: run {
            error = "Couldn't reach the app's activity — try again"
            return
        }
        val executor = ContextCompat.getMainExecutor(fa)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                doPair()
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                error = errString.toString()
            }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Confirm connection")
            .setSubtitle("Use your fingerprint or face to allow ${request.macName}")
            .setNegativeButtonText("Cancel")
            .build()
        BiometricPrompt(fa, executor, callback).authenticate(info)
    }

    fun reject() {
        busy = true
        scope.launch {
            MasterApi.rejectPair(request.host, request.code)
            busy = false
            onHandled()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Filled.Computer, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(bottom = 16.dp))
        Text("Connect ${request.macName}?", style = MaterialTheme.typography.headlineSmall)
        Text(
            "This computer wants to pair with AllieMinate over USB.",
            style = MaterialTheme.typography.bodyMedium,
            color = LocalAllieMinateColors.current.onSurfaceSecondary,
            modifier = Modifier.padding(top = 6.dp, bottom = 24.dp),
        )

        if (busy) {
            CircularProgressIndicator()
        } else {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = ::reject, modifier = Modifier.weight(1f)) { Text("No") }
                Button(onClick = ::confirmWithBiometric, modifier = Modifier.weight(1f)) { Text("Yes") }
            }
        }

        error?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
        }
    }
}
