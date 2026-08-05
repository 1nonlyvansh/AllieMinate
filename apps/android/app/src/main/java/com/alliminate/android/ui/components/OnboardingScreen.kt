package com.alliminate.android.ui.components

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.QrCodeScanner
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alliminate.android.data.Prefs
import com.alliminate.android.ui.theme.LocalAllieMinateColors

/** Shown once, on first launch — asks for every runtime permission the app actually uses up front
 * (notifications, photo library, camera for QR pairing) instead of surprising the user with scattered
 * prompts later. */
@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visible = true }

    val permissions = remember {
        buildList {
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
            add(Manifest.permission.CAMERA)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.READ_MEDIA_IMAGES) else add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
    }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        Prefs.setOnboarded(true)
        onDone()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        AnimatedVisibility(visible = visible, enter = fadeIn() + slideInVertically(initialOffsetY = { it / 6 })) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Welcome to AllieMinate", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text(
                    "A few permissions make this work well.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = LocalAllieMinateColors.current.onSurfaceSecondary,
                    modifier = Modifier.padding(top = 6.dp, bottom = 28.dp),
                )

                PermissionRow(Icons.Filled.Notifications, "Notifications", "Know when a transfer finishes")
                PermissionRow(Icons.Filled.QrCodeScanner, "Camera", "Scan the QR code to pair with your Mac or PC")
                PermissionRow(Icons.Filled.PhotoLibrary, "Photos", "Let your Master Device browse and back up your photos")

                Button(
                    onClick = { launcher.launch(permissions.toTypedArray()) },
                    modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
                ) { Text("Continue") }
            }
        }
    }
}

@Composable
private fun PermissionRow(icon: ImageVector, title: String, subtitle: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Column {
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceSecondary)
        }
    }
}
