package com.alliminate.android.ui.components

import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

private tailrec fun Context.findFragmentActivity(): FragmentActivity? = when (this) {
    is FragmentActivity -> this
    is ContextWrapper -> baseContext.findFragmentActivity()
    else -> null
}

/** One system prompt covering fingerprint, face, AND device PIN/pattern/password — used to gate
 * destructive actions (deleting a Sync Pair) the same way App Lock gates opening the app, but independent
 * of whether App Lock itself is turned on. Unlike a biometric-only prompt, DEVICE_CREDENTIAL fallback means
 * this works even on a phone with no fingerprint/face enrolled, as long as SOME screen lock is set — if
 * the phone has no screen lock at all, there's nothing to authenticate against and this reports
 * unavailable rather than silently blocking a destructive action forever.
 */
object DeviceAuth {
    fun isAvailable(context: Context): Boolean {
        val manager = BiometricManager.from(context)
        val authenticators = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        } else {
            BiometricManager.Authenticators.BIOMETRIC_WEAK
        }
        return manager.canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS
    }

    fun prompt(context: Context, title: String, subtitle: String, onSuccess: () -> Unit, onError: (String) -> Unit) {
        val activity = context.findFragmentActivity() ?: run {
            onError("Couldn't reach the app's activity — try again")
            return
        }
        val executor = ContextCompat.getMainExecutor(activity)
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) = onError(errString.toString())
        }
        val builder = BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle(subtitle)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL,
            )
        } else {
            // DEVICE_CREDENTIAL as a standalone flag needs API 30+; below that, this deprecated call is
            // still the only way to get PIN/pattern fallback alongside biometrics.
            @Suppress("DEPRECATION")
            builder.setDeviceCredentialAllowed(true)
        }
        BiometricPrompt(activity, executor, callback).authenticate(builder.build())
    }
}
