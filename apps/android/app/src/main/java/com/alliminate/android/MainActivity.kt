package com.alliminate.android

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.AnnotatedString
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.compose.ui.platform.LocalContext
import com.alliminate.android.ui.screens.CategoryFilesScreen
import com.alliminate.android.data.ApiResult
import com.alliminate.android.data.ContinuityHolder
import com.alliminate.android.data.ContinuityPayload
import com.alliminate.android.data.Downloads
import com.alliminate.android.data.LocalManifest
import com.alliminate.android.data.MasterApi
import com.alliminate.android.data.OfflineManifest
import com.alliminate.android.data.PairRequest
import com.alliminate.android.data.PendingPairRequest
import com.alliminate.android.data.PendingRoute
import com.alliminate.android.data.Prefs
import com.alliminate.android.data.SharedFileHolder
import com.alliminate.android.data.SyncActivityStore
import com.alliminate.android.data.SyncFileStateStore
import com.alliminate.android.data.SyncPairStore
import com.alliminate.android.notifications.TransferNotifications
import com.alliminate.android.service.LocalServerService
import com.alliminate.android.ui.components.AppDrawer
import com.alliminate.android.ui.components.LockScreen
import com.alliminate.android.ui.components.OnboardingScreen
import com.alliminate.android.ui.components.UsbPairConfirmScreen
import com.alliminate.android.ui.nav.Screen
import com.alliminate.android.ui.screens.CloudServicesScreen
import com.alliminate.android.ui.screens.DevicesScreen
import com.alliminate.android.ui.screens.OverviewScreen
import com.alliminate.android.ui.screens.SettingsScreen
import com.alliminate.android.ui.screens.ShareScreen
import com.alliminate.android.ui.screens.SyncScreen
import com.alliminate.android.ui.theme.AllieMinateTheme
import com.alliminate.android.work.SyncPushScheduler
import kotlinx.coroutines.launch

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Prefs.init(this)
        LocalManifest.init(this)
        OfflineManifest.init(this)
        SyncPairStore.init(this)
        SyncFileStateStore.init(this)
        SyncActivityStore.init(this)
        // Resumes periodic sync after an app/device restart — without this, sync would only ever start
        // right after the user creates a pair in the current session (SyncScreen's onCreated callback).
        if (SyncPairStore.list().any { it.status == "active" }) SyncPushScheduler.start(this)
        // Nearby Share needs this phone discoverable and able to receive requests even before/without
        // pairing — the service (and the beacon riding its lifecycle) now also starts for that alone,
        // not just once paired.
        if (Prefs.isPaired || Prefs.nearbyShareEnabled.value) LocalServerService.start(this)
        handleShareIntent(intent)
        handleWidgetIntent(intent)
        handlePairDeepLink(intent)
        handleContinuityIntent(intent)
        enableEdgeToEdge()
        val crashText = CrashHandler.readAndClear(this)
        setContent {
            AllieMinateTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AllieMinateApp()
                    if (crashText != null) CrashReportDialog(crashText)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
        handleWidgetIntent(intent)
        handlePairDeepLink(intent)
        handleContinuityIntent(intent)
    }

    private fun handleContinuityIntent(intent: Intent?) {
        if (intent?.action != TransferNotifications.ACTION_CONTINUITY) return
        val fromName = intent.getStringExtra(TransferNotifications.EXTRA_FROM_NAME) ?: return
        val fileName = intent.getStringExtra(TransferNotifications.EXTRA_FILE_NAME) ?: return
        val providerId = intent.getStringExtra(TransferNotifications.EXTRA_PROVIDER_ID) ?: return
        val key = intent.getStringExtra(TransferNotifications.EXTRA_KEY) ?: return
        val mimeType = intent.getStringExtra(TransferNotifications.EXTRA_MIME_TYPE)
        val masterId = intent.getStringExtra(TransferNotifications.EXTRA_MASTER_ID) ?: return
        ContinuityHolder.pending.value = ContinuityPayload(fromName, fileName, providerId, key, mimeType, masterId)
    }

    private fun handlePairDeepLink(intent: Intent?) {
        if (intent?.action != Intent.ACTION_VIEW) return
        val uri = intent.data ?: return
        if (uri.scheme != "alliminate" || uri.host != "pair") return
        val host = uri.getQueryParameter("host") ?: return
        val code = uri.getQueryParameter("code") ?: return
        val macName = uri.getQueryParameter("name") ?: "your Mac"

        // don't pair silently — show a branded Yes/No + fingerprint gate first (UsbPairConfirmScreen),
        // same as any "a computer wants to connect" prompt should work.
        PendingPairRequest.current.value = PairRequest(host, code, macName)
        postUsbConnectNotification(macName)
    }

    private fun postUsbConnectNotification(macName: String) {
        val channelId = "alliminate_usb_pair"
        val manager = getSystemService(android.app.NotificationManager::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O && manager.getNotificationChannel(channelId) == null) {
            manager.createNotificationChannel(
                android.app.NotificationChannel(channelId, "USB Pairing", android.app.NotificationManager.IMPORTANCE_HIGH),
            )
        }
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            androidx.core.content.ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val openIntent = Intent(this, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP }
        val pendingIntent = android.app.PendingIntent.getActivity(
            this, 2, openIntent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = androidx.core.app.NotificationCompat.Builder(this, channelId)
            .setContentTitle("Connect $macName via USB?")
            .setContentText("Tap to confirm in AllieMinate")
            .setSmallIcon(R.drawable.ic_notification)
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()
        androidx.core.app.NotificationManagerCompat.from(this).notify(9001, notification)
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val uri = if (android.os.Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(Intent.EXTRA_STREAM, android.net.Uri::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(Intent.EXTRA_STREAM)
        }
        if (uri == null) return
        SharedFileHolder.pendingUri.value = uri
        // which of the two share-sheet entries the user tapped — both point at MainActivity via
        // activity-alias, distinguished only by which alias resolved the intent.
        SharedFileHolder.mode.value = if (intent.component?.className?.endsWith("ShareToDeviceAlias") == true) "device" else "cloud"
    }

    private fun handleWidgetIntent(intent: Intent?) {
        val route = intent?.getStringExtra(com.alliminate.android.widget.EXTRA_OPEN_ROUTE) ?: return
        PendingRoute.route.value = route
    }
}

@Composable
private fun CrashReportDialog(text: String) {
    var visible by remember { mutableStateOf(true) }
    if (!visible) return
    val clipboard = LocalClipboardManager.current
    AlertDialog(
        onDismissRequest = { visible = false },
        title = { Text("AllieMinate crashed last time") },
        text = { Text(text.take(4000), style = androidx.compose.material3.MaterialTheme.typography.bodySmall) },
        confirmButton = {
            TextButton(onClick = { clipboard.setText(AnnotatedString(text)) }) { Text("Copy") }
        },
        dismissButton = { TextButton(onClick = { visible = false }) { Text("Dismiss") } },
    )
}

@Composable
private fun AllieMinateApp() {
    if (!Prefs.onboarded.value) {
        OnboardingScreen(onDone = {})
        return
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    // starts locked whenever App Lock is on — covers both a cold start with the setting already on, and
    // the setting being switched on mid-session (it used to only ever re-lock on the NEXT backgrounding,
    // never immediately, because this was seeded once from `remember` and never re-read).
    var unlocked by remember { mutableStateOf(!Prefs.appLockEnabled.value) }

    LaunchedEffect(Prefs.appLockEnabled.value) {
        if (Prefs.appLockEnabled.value) unlocked = false
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && Prefs.appLockEnabled.value) unlocked = false
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    if (Prefs.appLockEnabled.value && !unlocked) {
        LockScreen(onUnlocked = { unlocked = true })
        return
    }

    val pairRequest = PendingPairRequest.current.value
    if (pairRequest != null) {
        UsbPairConfirmScreen(
            request = pairRequest,
            onHandled = { PendingPairRequest.current.value = null },
        )
        return
    }

    AllieMinateContent()
}

@Composable
private fun AllieMinateContent() {
    val navController: NavHostController = rememberNavController()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val backStackEntry = navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry.value?.destination?.route

    // Continuity Handoff — tapping the "Continue on this phone?" notification lands here with the file
    // still on the Master Device; download it fresh (same MasterApi route Cloud Services already uses to
    // fetch a provider file by key) and open it, mirroring downloadAndOpen() in CloudServicesScreen.kt.
    LaunchedEffect(ContinuityHolder.pending.value) {
        val payload = ContinuityHolder.pending.value ?: return@LaunchedEffect
        ContinuityHolder.pending.value = null
        val master = Prefs.masterById(payload.masterId)
        val host = master?.host
        val token = master?.token
        if (host == null || token == null) {
            Toast.makeText(context, "Not paired with a Master Device", Toast.LENGTH_SHORT).show()
            return@LaunchedEffect
        }
        Toast.makeText(context, "Getting \"${payload.fileName}\" from ${payload.fromName}…", Toast.LENGTH_SHORT).show()
        when (val result = MasterApi.downloadBytes(host, token, payload.providerId, payload.key)) {
            is ApiResult.Ok -> {
                val mime = Downloads.guessMimeType(payload.fileName, payload.mimeType)
                val uri = Downloads.save(context, payload.fileName, mime, result.value)
                if (uri == null) {
                    Toast.makeText(context, "Couldn't save \"${payload.fileName}\"", Toast.LENGTH_SHORT).show()
                } else {
                    val openIntent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, mime)
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                    }
                    val opened = runCatching { context.startActivity(openIntent) }.isSuccess
                    if (!opened) Toast.makeText(context, "No app on this phone can open \"${payload.fileName}\"", Toast.LENGTH_LONG).show()
                }
            }
            is ApiResult.Err -> Toast.makeText(context, "Couldn't get \"${payload.fileName}\": ${result.message}", Toast.LENGTH_LONG).show()
        }
    }

    LaunchedEffect(SharedFileHolder.pendingUri.value) {
        if (SharedFileHolder.pendingUri.value != null && currentRoute != Screen.Share.route) {
            navController.navigate(Screen.Share.route) { launchSingleTop = true }
        }
    }

    LaunchedEffect(PendingRoute.route.value) {
        val route = PendingRoute.route.value
        if (route != null && currentRoute != route) {
            navController.navigate(route) { launchSingleTop = true }
        }
        PendingRoute.route.value = null
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            AppDrawer(currentRoute = currentRoute) { screen ->
                scope.launch { drawerState.close() }
                if (currentRoute != screen.route) {
                    navController.navigate(screen.route) {
                        popUpTo(Screen.Overview.route) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                }
            }
        },
    ) {
        Scaffold { padding ->
            NavHost(
                navController = navController,
                startDestination = Screen.Overview.route,
                modifier = Modifier.fillMaxSize().padding(padding),
                enterTransition = { fadeIn(animationSpec = tween(180)) },
                exitTransition = { fadeOut(animationSpec = tween(140)) },
            ) {
                composable(Screen.Overview.route) {
                    OverviewScreen(
                        onOpenDrawer = { scope.launch { drawerState.open() } },
                        onNavigate = { route -> navController.navigate(route) { launchSingleTop = true } },
                    )
                }
                composable(
                    "category/{category}",
                    arguments = listOf(navArgument("category") { type = NavType.StringType }),
                ) { backStack ->
                    val category = backStack.arguments?.getString("category") ?: "image"
                    CategoryFilesScreen(category = category, onBack = { navController.popBackStack() })
                }
                composable(Screen.Devices.route) { DevicesScreen(onOpenDrawer = { scope.launch { drawerState.open() } }) }
                composable(Screen.CloudServices.route) { CloudServicesScreen(onOpenDrawer = { scope.launch { drawerState.open() } }) }
                composable(Screen.Share.route) { ShareScreen(onOpenDrawer = { scope.launch { drawerState.open() } }) }
                composable(Screen.Settings.route) { SettingsScreen(onOpenDrawer = { scope.launch { drawerState.open() } }) }
                composable(Screen.Sync.route) { SyncScreen(onOpenDrawer = { scope.launch { drawerState.open() } }) }
            }
        }
    }
}
