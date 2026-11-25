package com.example.ui.settings

import android.webkit.CookieManager
import android.webkit.WebStorage
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.common.FriendlyErrorMapper
import com.example.core.security.SecurityStatusTracker
import com.example.data.local.dao.TrackSignalDao
import com.example.data.remote.AppUpdateRepository
import com.example.data.remote.UpdateCheckOutcome
import com.example.data.repository.PlaybackPersistenceStore
import com.example.domain.model.AppSettings
import com.example.domain.repository.LibraryRepository
import com.example.domain.repository.SettingsRepository
import com.example.domain.repository.YouTubeAccountRepository
import com.example.playback.AudioCacheProvider
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@Immutable
data class SecurityUiState(
    val settings: AppSettings = AppSettings(),
    val databaseEncrypted: Boolean = false,
    val keystoreBacked: Boolean = false,
    val blockedInsecureCount: Int = 0,
    val lastBlockedHost: String? = null,
    val isCheckingUpdates: Boolean = false,
    val isWipingData: Boolean = false
)

@HiltViewModel
class SecurityViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val securityStatusTracker: SecurityStatusTracker,
    private val appUpdateRepository: AppUpdateRepository,
    private val libraryRepository: LibraryRepository,
    private val youTubeAccountRepository: YouTubeAccountRepository,
    private val playbackPersistenceStore: PlaybackPersistenceStore,
    private val audioCacheProvider: AudioCacheProvider,
    private val trackSignalDao: TrackSignalDao
) : ViewModel() {

    private val isCheckingUpdatesFlow = MutableStateFlow(false)
    private val isWipingDataFlow = MutableStateFlow(false)

    private val telemetryFlow = combine(
        securityStatusTracker.databaseEncrypted,
        securityStatusTracker.keystoreBacked,
        securityStatusTracker.blockedInsecureCount,
        securityStatusTracker.lastBlockedHost
    ) { dbEnc, ksBacked, blockedCount, lastHost ->
        TelemetrySnapshot(dbEnc, ksBacked, blockedCount, lastHost)
    }

    val uiState: StateFlow<SecurityUiState> = combine(
        settingsRepository.settings,
        telemetryFlow,
        isCheckingUpdatesFlow,
        isWipingDataFlow
    ) { settings, telemetry, checking, wiping ->
        SecurityUiState(
            settings = settings,
            databaseEncrypted = telemetry.databaseEncrypted,
            keystoreBacked = telemetry.keystoreBacked,
            blockedInsecureCount = telemetry.blockedInsecureCount,
            lastBlockedHost = telemetry.lastBlockedHost,
            isCheckingUpdates = checking,
            isWipingData = wiping
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = SecurityUiState()
    )

    fun setEncryptBackupsEnabled(enabled: Boolean) {
        viewModelScope.launch {
            settingsRepository.setEncryptBackupsEnabled(enabled)
        }
    }

    fun setScreenSecurityEnabled(enabled: Boolean) {
        viewModelScope.launch {
            settingsRepository.setScreenSecurityEnabled(enabled)
        }
    }

    fun setAutoCheckUpdatesEnabled(enabled: Boolean) {
        viewModelScope.launch {
            settingsRepository.setAutoCheckUpdatesEnabled(enabled)
        }
    }

    fun checkForUpdatesNow(
        onUpToDateOrError: (String) -> Unit,
        onUpdateAvailable: (String) -> Unit
    ) {
        if (isCheckingUpdatesFlow.value) return
        viewModelScope.launch {
            isCheckingUpdatesFlow.value = true
            try {
                settingsRepository.setLastUpdateCheckAtMs(System.currentTimeMillis())
                when (val outcome = appUpdateRepository.checkForUpdate()) {
                    is UpdateCheckOutcome.UpdateAvailable -> {
                        onUpdateAvailable(outcome.info.tagName)
                    }
                    is UpdateCheckOutcome.UpToDate -> {
                        onUpToDateOrError("Установлена актуальная версия (${outcome.currentVersion})")
                    }
                    is UpdateCheckOutcome.Failure -> {
                        onUpToDateOrError(outcome.message)
                    }
                }
            } finally {
                isCheckingUpdatesFlow.value = false
            }
        }
    }

    fun wipeSensitiveData(onComplete: (String) -> Unit) {
        if (isWipingDataFlow.value) return
        viewModelScope.launch {
            isWipingDataFlow.value = true
            runCatching {
                youTubeAccountRepository.signOutAll()
                runCatching {
                    val cookieManager = CookieManager.getInstance()
                    cookieManager.removeAllCookies(null)
                    cookieManager.flush()
                }
                runCatching { WebStorage.getInstance().deleteAllData() }
                playbackPersistenceStore.clearAll()
                libraryRepository.clearHistory()
                libraryRepository.clearSearchHistory()
                trackSignalDao.clearAll()
                audioCacheProvider.clearCache()
            }.fold(
                onSuccess = {
                    isWipingDataFlow.value = false
                    onComplete("Сессии, cookies, история и временный кэш очищены")
                },
                onFailure = { err ->
                    isWipingDataFlow.value = false
                    onComplete(FriendlyErrorMapper.map(err, "Не удалось полностью очистить данные"))
                }
            )
        }
    }

    private data class TelemetrySnapshot(
        val databaseEncrypted: Boolean,
        val keystoreBacked: Boolean,
        val blockedInsecureCount: Int,
        val lastBlockedHost: String?
    )
}
