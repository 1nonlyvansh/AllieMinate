package com.alliminate.android.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alliminate.android.ui.components.GlassCard
import com.alliminate.android.ui.components.ScreenScaffold
import com.alliminate.android.ui.theme.LocalAllieMinateColors

private const val GITHUB_REPO_URL = "https://github.com/1nonlyvansh/AllieMinate"
private const val DEV_GITHUB_URL = "https://github.com/1nonlyvansh"
private const val DEV_INSTAGRAM_URL = "https://instagram.com/1nonlyvansh"
private const val DEV_LINKEDIN_URL = "https://www.linkedin.com/in/vanshkishore/"
private const val DEV_EMAIL = "vansh080605@gmail.com"
private const val DEV_WHATSAPP = "919136158580"

private val FEATURES = listOf(
    "One place for every cloud" to "Google Drive (multi-account), OneDrive, MEGA, pCloud, Backblaze B2, and any S3-compatible bucket — browse, upload, and organize all of them from one app.",
    "Cross-device Sync Pairs" to "Two-way, backup-only, or download-only sync between any local folder and a cloud account or a paired device — with bandwidth limits, ignore rules, and conflict resolution.",
    "Universal Sync" to "One shared folder, broadcast to every device you grant it to — your Mac, Windows PC, and this phone all stay in sync with a single host folder.",
    "Device pairing over LAN" to "Pair this phone directly with a Mac or Windows PC — browse files, send files instantly, and see live battery/online status, no cloud relay in between.",
    "Universal Clipboard" to "Copy on your Mac/PC, paste on this phone, automatically.",
    "Nearby Share" to "Send a file to any AllieMinate device on the same WiFi instantly, even before it's paired.",
    "Real file management" to "Rename, move, copy, trash, and preview files across every connected cloud and device.",
    "Built-in security" to "Optional App Lock with fingerprint/face unlock, and destructive actions gated behind device authentication.",
)

private val USE_CASES = listOf(
    "Keep your Screenshots or Camera folder mirrored across your phone, Mac, and Windows PC without paying for three different sync services.",
    "Consolidate storage spread across several Google accounts and other providers into one searchable space.",
    "Send a file from this phone straight to your Mac's Downloads folder, or the other way around, without cables or a shared cloud folder.",
    "Copy a link on your computer and paste it straight into this phone, mid-conversation.",
    "Set up a folder once (Universal Sync) and have it show up, live, on every device you own.",
)

private val DIFFERENTIATORS = listOf(
    "Most cloud managers stop at \"browse your cloud.\" AllieMinate also does device-to-device sync, LAN file transfer, clipboard sharing, and remote unlock — one app instead of four.",
    "Sync direction and conflict handling are explicit and per-pair, not a black box — you choose two-way, backup-only, or download-only for every folder.",
    "No mandatory account, no subscription, no cloud relay for device-to-device features — pairing and Nearby Share go directly over your own network.",
    "Open source — the whole thing, not a trial. Read the code, build it yourself, or contribute.",
)

@Composable
fun AboutScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val colors = LocalAllieMinateColors.current

    fun openUrl(url: String) {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }

    ScreenScaffold("About AllieMinate", onBack) {
        GlassCard {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("AllieMinate", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("A Space With You", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceTertiary)
                Text(
                    "AllieMinate is a cross-platform cloud storage aggregator and device-sync suite for macOS, " +
                        "Windows, and Android. It brings every cloud account you use into one app, syncs folders " +
                        "across your own devices without a subscription, and lets your phone, Mac, and PC talk to " +
                        "each other directly — file transfer, clipboard, and remote unlock included.",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.onSurfaceSecondary,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }

        SectionLabel("Features")
        FEATURES.forEach { (title, desc) -> InfoCard(title, desc) }

        SectionLabel("Use Cases")
        GlassCard {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                USE_CASES.forEach { Text("•  $it", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceSecondary) }
            }
        }

        SectionLabel("How AllieMinate is different")
        GlassCard {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                DIFFERENTIATORS.forEach { Text("•  $it", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceSecondary) }
            }
        }

        SectionLabel("Open Source")
        LinkRow(Icons.Filled.Code, "github.com/1nonlyvansh/AllieMinate") { openUrl(GITHUB_REPO_URL) }

        SectionLabel("About Developer")
        GlassCard {
            Text("Vansh Kishore Sharma", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.padding(16.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            LinkRow(Icons.Filled.Code, "github.com/1nonlyvansh") { openUrl(DEV_GITHUB_URL) }
            LinkRow(Icons.Filled.Code, "instagram.com/1nonlyvansh") { openUrl(DEV_INSTAGRAM_URL) }
            LinkRow(Icons.Filled.Code, "linkedin.com/in/vanshkishore") { openUrl(DEV_LINKEDIN_URL) }
        }

        SectionLabel("Need Help or Give a Suggestion?")
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            LinkRow(Icons.Filled.Email, DEV_EMAIL) {
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:$DEV_EMAIL")))
                }
            }
            LinkRow(Icons.Filled.Code, "+91 91361 58580 (WhatsApp)") { openUrl("https://wa.me/$DEV_WHATSAPP") }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = LocalAllieMinateColors.current.onSurfaceTertiary,
        modifier = Modifier.padding(top = 18.dp, bottom = 4.dp, start = 4.dp),
    )
}

@Composable
private fun InfoCard(title: String, desc: String) {
    GlassCard {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text(desc, style = MaterialTheme.typography.bodySmall, color = LocalAllieMinateColors.current.onSurfaceTertiary)
        }
    }
}

@Composable
private fun LinkRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(LocalAllieMinateColors.current.surfaceStrong)
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Icon(Icons.Filled.ChevronRight, contentDescription = null, tint = LocalAllieMinateColors.current.onSurfaceTertiary)
    }
}
