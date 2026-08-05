package com.alliminate.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.alliminate.android.ui.theme.LocalAllieMinateColors

/** Every screen body is a vertically-scrolling column that never exceeds the device width — matches the
 * desktop app's "everything that overflows scrolls down, not sideways" layout rule. */
@Composable
fun ScreenScroll(content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        content = content,
    )
}

@Composable
fun ScreenHeader(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.headlineLarge)
        Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = LocalAllieMinateColors.current.onSurfaceSecondary)
    }
}

/** Frosted-glass background modifier — a soft diagonal gradient over the surface color plus a hairline
 * border, approximating the desktop app's `backdrop-filter` glass cards without needing a real blur
 * (Compose's RenderEffect blur only works on API 31+, and minSdk here is 26). Shared by every card-style
 * surface so the whole app reads as one glass system instead of a plain Material file-manager list. */
@Composable
fun Modifier.glassSurface(cornerRadius: androidx.compose.ui.unit.Dp = 18.dp): Modifier {
    val colors = LocalAllieMinateColors.current
    return this
        .clip(RoundedCornerShape(cornerRadius))
        .background(
            Brush.linearGradient(
                colors = listOf(
                    colors.surfaceStrong.copy(alpha = 0.95f),
                    colors.surfaceStrong.copy(alpha = 0.72f),
                ),
            ),
        )
        .border(1.dp, colors.hairline, RoundedCornerShape(cornerRadius))
}

/** A glass-panel container for grouping related content — the Overview/Devices/Cloud Services screens'
 * primary building block. */
@Composable
fun GlassCard(modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .glassSurface(),
        content = content,
    )
}

/** Small filled circle for online/offline/warning status — pairs with a label to avoid relying on color
 * alone. */
@Composable
fun StatusDot(color: Color, modifier: Modifier = Modifier) {
    Box(modifier = modifier.size(8.dp).clip(CircleShape).background(color))
}

/** Circular tinted icon badge (accent-soft fill, accent-colored icon) — used in place of a bare Material
 * icon wherever a card needs to feel like a dashboard tile rather than a file-list row. */
@Composable
fun IconBadge(icon: ImageVector, tint: Color = MaterialTheme.colorScheme.primary, background: Color = MaterialTheme.colorScheme.primaryContainer) {
    Box(
        modifier = Modifier
            .size(40.dp)
            .clip(CircleShape)
            .background(background),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint)
    }
}

/** Mirrors the desktop app's ".glass-card.empty-state" — a soft rounded card, centered icon + message. */
@Composable
fun EmptyStateCard(icon: ImageVector, message: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .glassSurface()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(icon, contentDescription = null, tint = LocalAllieMinateColors.current.onSurfaceTertiary)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = LocalAllieMinateColors.current.onSurfaceSecondary)
    }
}

/** Every tab shares this shell: a top bar with the hamburger (drawer) button + title, and a
 * vertically-scrolling body below it. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScreenScaffold(
    title: String,
    onOpenDrawer: () -> Unit,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    Scaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onOpenDrawer) {
                        Icon(Icons.Filled.Menu, contentDescription = "Open menu")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding)) {
            ScreenScroll(content)
        }
    }
}

/** A generic tab body until each screen gets its real content wired to the Master Device backend
 * (Phase 1+) — every nav destination should render something immediately rather than a blank screen. */
@Composable
fun PlaceholderScreen(title: String, subtitle: String, icon: ImageVector, emptyMessage: String, onOpenDrawer: () -> Unit) {
    ScreenScaffold(title, onOpenDrawer) {
        ScreenHeader(title, subtitle)
        EmptyStateCard(icon, emptyMessage)
    }
}
