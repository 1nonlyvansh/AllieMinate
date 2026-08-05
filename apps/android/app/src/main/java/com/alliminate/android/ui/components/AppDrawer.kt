package com.alliminate.android.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.NavigationDrawerItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alliminate.android.ui.nav.Screen

/** Brand header, then every real tab this phone actually has — vertically stacked and scrollable, never
 * wider than the drawer itself so nothing needs to scroll sideways. */
@Composable
fun AppDrawer(currentRoute: String?, onNavigate: (Screen) -> Unit) {
    ModalDrawerSheet(
        modifier = Modifier
            .fillMaxHeight()
            .width(280.dp),
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(rememberScrollState())
                .padding(vertical = 12.dp),
        ) {
            Text(
                text = "AllieMinate",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
            )

            Screen.primaryNav.forEach { screen ->
                DrawerRow(screen, selected = currentRoute == screen.route, onClick = { onNavigate(screen) })
            }

            DrawerRow(Screen.Sync, selected = currentRoute == Screen.Sync.route, onClick = { onNavigate(Screen.Sync) })
            DrawerRow(Screen.Settings, selected = currentRoute == Screen.Settings.route, onClick = { onNavigate(Screen.Settings) })
        }
    }
}

@Composable
private fun DrawerRow(screen: Screen, selected: Boolean, onClick: () -> Unit) {
    NavigationDrawerItem(
        icon = { Icon(screen.icon, contentDescription = null) },
        label = { Text(screen.label) },
        selected = selected,
        onClick = onClick,
        colors = NavigationDrawerItemDefaults.colors(
            selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
        ),
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 2.dp),
    )
}
