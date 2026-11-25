package com.example

import android.Manifest
import android.app.SearchManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.core.common.NetworkMonitor
import com.example.data.remote.AppUpdateRepository
import com.example.data.remote.UpdateCheckOutcome
import com.example.domain.model.AppSettings
import com.example.domain.model.AppThemeMode
import com.example.domain.repository.SettingsRepository
import com.example.ui.navigation.SonoraNavHost
import com.example.ui.theme.SonoraTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var settingsRepository: SettingsRepository

    @Inject
    lateinit var appUpdateRepository: AppUpdateRepository

    @Inject
    lateinit var networkMonitor: NetworkMonitor

    private val pendingSearchQueryFlow = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleIncomingIntent(intent)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
        )
        setContent {
            val appSettings by settingsRepository.settings.collectAsStateWithLifecycle(
                initialValue = AppSettings()
            )
            val pendingSearchQuery by pendingSearchQueryFlow.collectAsStateWithLifecycle()
            var startupAvailableVersion by remember { mutableStateOf<String?>(null) }

            val isDark = when (appSettings.themeMode) {
                AppThemeMode.DARK -> true
                AppThemeMode.LIGHT -> false
                AppThemeMode.SYSTEM -> isSystemInDarkTheme()
            }

            LaunchedEffect(isDark) {
                val style = if (isDark) {
                    SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                } else {
                    SystemBarStyle.light(
                        android.graphics.Color.TRANSPARENT,
                        android.graphics.Color.TRANSPARENT
                    )
                }
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }

            LaunchedEffect(appSettings.screenSecurityEnabled) {
                if (appSettings.screenSecurityEnabled) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
                }
            }

            SonoraTheme(
                themeMode = appSettings.themeMode,
                dynamicColor = appSettings.dynamicColorEnabled
            ) {
                val context = LocalContext.current
                val notificationPermissionLauncher = rememberLauncherForActivityResult(
                    contract = ActivityResultContracts.RequestPermission(),
                    onResult = { }
                )

                LaunchedEffect(Unit) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        val granted = ContextCompat.checkSelfPermission(
                            context,
                            Manifest.permission.POST_NOTIFICATIONS
                        ) == PackageManager.PERMISSION_GRANTED
                        if (!granted) {
                            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                        }
                    }

                    runCatching {
                        val persisted = settingsRepository.settings.first()
                        val now = System.currentTimeMillis()
                        val due = persisted.autoCheckUpdatesEnabled &&
                            networkMonitor.isOnline.value &&
                            (now - persisted.lastUpdateCheckAtMs >= AUTO_UPDATE_INTERVAL_MS)
                        if (due) {
                            settingsRepository.setLastUpdateCheckAtMs(now)
                            val outcome = appUpdateRepository.checkForUpdate()
                            if (outcome is UpdateCheckOutcome.UpdateAvailable) {
                                startupAvailableVersion = outcome.info.tagName
                            }
                        }
                    }
                }

                SonoraNavHost(
                    pendingSearchQuery = pendingSearchQuery,
                    onConsumePendingSearchQuery = { pendingSearchQueryFlow.value = null },
                    startupUpdateTag = startupAvailableVersion,
                    onConsumeStartupUpdate = { startupAvailableVersion = null }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return
        val query = intent.getStringExtra(SearchManager.QUERY)
            ?: intent.getStringExtra(Intent.EXTRA_TEXT)
        if (!query.isNullOrBlank()) {
            pendingSearchQueryFlow.value = query.trim()
        }
    }

    private companion object {
        const val AUTO_UPDATE_INTERVAL_MS = 24L * 60L * 60L * 1000L
    }
}
