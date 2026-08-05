package com.alliminate.android.ui.components

import androidx.biometric.BiometricPrompt
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.alliminate.android.ui.theme.LocalAllieMinateColors

private tailrec fun Context.findFragmentActivity(): FragmentActivity? = when (this) {
    is FragmentActivity -> this
    is ContextWrapper -> baseContext.findFragmentActivity()
    else -> null
}

/** Same gate as the desktop App Lock — blocks the app UI until Touch ID/fingerprint/face unlock succeeds.
 * Re-shown by MainActivity every time the app returns from the background. */
@Composable
fun LockScreen(onUnlocked: () -> Unit) {
    val context = LocalContext.current
    // LocalContext.current can be a ContextWrapper (e.g. a themed context) rather than the Activity
    // itself — a plain `as? FragmentActivity` cast silently failed in that case and `prompt()` did
    // nothing at all, no error, no dialog, which is exactly what "App Lock doesn't lock" looks like.
    val activity = remember(context) { context.findFragmentActivity() }
    var error by remember { mutableStateOf<String?>(null) }

    fun prompt() {
        val fa = activity ?: run {
            error = "Couldn't reach the app's activity — tap Unlock to retry"
            return
        }
        val executor = ContextCompat.getMainExecutor(fa)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                onUnlocked()
            }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                error = errString.toString()
            }
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock AllieMinate")
            .setSubtitle("Use your fingerprint or face to continue")
            .setNegativeButtonText("Cancel")
            .build()
        BiometricPrompt(fa, executor, callback).authenticate(info)
    }

    LaunchedEffect(Unit) { prompt() }

    val pulse = rememberInfiniteTransition(label = "lock-pulse")
    val scale by pulse.animateFloat(
        initialValue = 1f,
        targetValue = 1.12f,
        animationSpec = infiniteRepeatable(animation = tween(900), repeatMode = RepeatMode.Reverse),
        label = "lock-pulse-scale",
    )

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(
            Icons.Filled.Fingerprint,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.padding(bottom = 16.dp).scale(scale),
        )
        Text("AllieMinate is locked", style = MaterialTheme.typography.titleLarge)
        error?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary, modifier = Modifier.padding(top = 8.dp))
        }
        Button(onClick = ::prompt, modifier = Modifier.padding(top = 20.dp)) { Text("Unlock") }
    }
}
