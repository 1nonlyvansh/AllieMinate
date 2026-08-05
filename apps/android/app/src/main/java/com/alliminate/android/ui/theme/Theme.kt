package com.alliminate.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// extra tokens Material3's ColorScheme doesn't have a slot for (glass-card surface, online/offline
// status dots, hairline borders) — mirrors the desktop app's CSS custom properties beyond the basics.
data class AllieMinateExtraColors(
    val surfaceStrong: Color,
    val onSurfaceSecondary: Color,
    val onSurfaceTertiary: Color,
    val online: Color,
    val offline: Color,
    val warning: Color,
    val hairline: Color,
)

val LocalAllieMinateColors = androidx.compose.runtime.staticCompositionLocalOf {
    AllieMinateExtraColors(
        surfaceStrong = DarkSurfaceStrong,
        onSurfaceSecondary = DarkOnSurfaceSecondary,
        onSurfaceTertiary = DarkOnSurfaceTertiary,
        online = DarkOnline,
        offline = DarkOffline,
        warning = DarkWarning,
        hairline = DarkHairline,
    )
}

private val DarkScheme = darkColorScheme(
    primary = DarkAccent,
    onPrimary = Color.White,
    primaryContainer = DarkAccentSoft,
    background = DarkBackground,
    onBackground = DarkOnSurface,
    surface = DarkSurface,
    onSurface = DarkOnSurface,
    error = DarkOffline,
)

private val LightScheme = lightColorScheme(
    primary = LightAccent,
    onPrimary = Color.White,
    primaryContainer = LightAccentSoft,
    background = LightBackground,
    onBackground = LightOnSurface,
    surface = LightSurface,
    onSurface = LightOnSurface,
    error = LightOffline,
)

@Composable
fun AllieMinateTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val scheme = if (darkTheme) DarkScheme else LightScheme
    val extras = if (darkTheme) {
        AllieMinateExtraColors(DarkSurfaceStrong, DarkOnSurfaceSecondary, DarkOnSurfaceTertiary, DarkOnline, DarkOffline, DarkWarning, DarkHairline)
    } else {
        AllieMinateExtraColors(LightSurfaceStrong, LightOnSurfaceSecondary, LightOnSurfaceTertiary, LightOnline, LightOffline, LightWarning, LightHairline)
    }

    androidx.compose.runtime.CompositionLocalProvider(LocalAllieMinateColors provides extras) {
        MaterialTheme(
            colorScheme = scheme,
            typography = AllieMinateTypography,
            content = content,
        )
    }
}
