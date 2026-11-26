package com.example.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.common.FriendlyErrorMapper
import com.example.data.local.FavoritesAutoDownloadManager
import com.example.data.remote.ApkDownloadEvent
import com.example.data.remote.AppUpdateRepository
import com.example.data.remote.UpdateCheckOutcome
import com.example.data.repository.BackupCoordinator
import com.example.data.repository.BackupRestoreSummary
import com.example.domain.model.AppSettings
import com.example.domain.model.AppThemeMode
import com.example.domain.model.AppUpdateInfo
import com.example.domain.model.AppUpdateUiState
import com.example.domain.model.AudioQuality
import com.example.domain.model.PlaybackState
import com.example.domain.repository.LibraryRepository
import com.example.domain.repository.SettingsRepository
import com.example.domain.repository.YouTubeAccountRepository
import com.example.playback.AudioCacheProvider
import com.example.playback.EqualizerState
import com.example.playback.PlaybackManager
import com.example.playback.SonoraEqualizerManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

data class SettingsUiState(
    val settings: AppSettings = AppSettings(),
    val playbackState: PlaybackState = PlaybackState(),
    val equalizerState: EqualizerState = EqualizerState(),
    val cacheSizeBytes: Long = 0L,
    val offlineDownloadsBytes: Long = 0L,
    val offlineTracksCount: Int = 0,
    val favoritesCount: Int = 0,
    val playlistsCount: Int = 0,
    val updateState: AppUpdateUiState = AppUpdateUiState.Idle,
    val lastAutoBackupLocation: String? = null
) {
    val totalStorageBytes: Long
        get() = cacheSizeBytes + offlineDownloadsBytes
}

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val libraryRepository: LibraryRepository,
    private val backupCoordinator: BackupCoordinator,
    private val audioCacheProvider: AudioCacheProvider,
    private val playbackManager: PlaybackManager,
    private val equalizerManager: SonoraEqualizerManager,
    private val appUpdateRepository: AppUpdateRepository,
    private val favoritesAutoDownloadManager: FavoritesAutoDownloadManager,
    private val youTubeAccountRepository: YouTubeAccountRepository
) : ViewModel() {

    private val cacheSizeFlow = MutableStateFlow(0L)
    private val updateStateFlow = MutableStateFlow<AppUpdateUiState>(AppUpdateUiState.Idle)
    private val autoBackupLocationFlow = MutableStateFlow<String?>(null)
    private var updateDownloadJob: Job? = null

    private val libraryStatsFlow = combine(
        libraryRepository.observeDownloadedBytes(),
        libraryRepository.observeDownloadedIds().map { it.size },
        libraryRepository.observeFavoriteIds().map { it.size },
        libraryRepository.observePlaylists().map { it.size }
    ) { downloadedBytes, downloadedCount, favCount, playlistCount ->
        LibraryStorageStats(
            offlineDownloadsBytes = downloadedBytes,
            offlineTracksCount = downloadedCount,
            favoritesCount = favCount,
            playlistsCount = playlistCount
        )
    }

    val uiState: StateFlow<SettingsUiState> = combine(
        settingsRepository.settings,
        playbackManager.playbackState,
        equalizerManager.state,
        cacheSizeFlow,
        combine(updateStateFlow, autoBackupLocationFlow, libraryStatsFlow) { update, backupLoc, stats ->
            Triple(update, backupLoc, stats)
        }
    ) { settings, playback, eq, streamCacheBytes, (update, backupLoc, stats) ->
        SettingsUiState(
            settings = settings,
            playbackState = playback,
            equalizerState = eq,
            cacheSizeBytes = streamCacheBytes,
            offlineDownloadsBytes = stats.offlineDownloadsBytes,
            offlineTracksCount = stats.offlineTracksCount,
            favoritesCount = stats.favoritesCount,
            playlistsCount = stats.playlistsCount,
            updateState = update,
            lastAutoBackupLocation = backupLoc
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = SettingsUiState()
    )

    init {
        refreshCacheSize()
    }

    fun refreshCacheSize() {
        viewModelScope.launch {
            cacheSizeFlow.value = audioCacheProvider.getCacheSizeBytes()
        }
    }

    fun setAudioQuality(quality: AudioQuality) {
        viewModelScope.launch { settingsRepository.setAudioQuality(quality) }
    }

    fun setThemeMode(mode: AppThemeMode) {
        viewModelScope.launch { settingsRepository.setThemeMode(mode) }
    }

    fun setDynamicColorEnabled(enabled: Boolean) {
        viewModelScope.launch { settingsRepository.setDynamicColorEnabled(enabled) }
    }

    fun setSkipSilenceEnabled(enabled: Boolean) {
        viewModelScope.launch { settingsRepository.setSkipSilenceEnabled(enabled) }
    }

    fun setAutoplayEnabled(enabled: Boolean) {
        viewModelScope.launch { settingsRepository.setAutoplayEnabled(enabled) }
    }

    fun setGaplessPlaybackEnabled(enabled: Boolean) {
        viewModelScope.launch { settingsRepository.setGaplessPlaybackEnabled(enabled) }
    }

    fun setAutoDownloadFavoritesWifi(enabled: Boolean) {
        viewModelScope.launch {
            if (enabled) {
                favoritesAutoDownloadManager.resetRetryState()
            }
            settingsRepository.setAutoDownloadFavoritesWifi(enabled)
        }
    }

    fun startSleepTimer(minutes: Int) = playbackManager.startSleepTimer(minutes)

    fun cancelSleepTimer() = playbackManager.cancelSleepTimer()

    fun setEqualizerEnabled(enabled: Boolean) = equalizerManager.setEnabled(enabled)

    fun selectEqualizerPreset(index: Int) = equalizerManager.selectPreset(index)

    fun setEqualizerBand(bandIndex: Int, levelMb: Short) =
        equalizerManager.setBandLevel(bandIndex, levelMb)

    fun setBassBoostStrength(strength: Int) = equalizerManager.setBassBoostStrength(strength)

    fun setVirtualizerEnabled(enabled: Boolean) = equalizerManager.setVirtualizerEnabled(enabled)

    fun resetEqualizer() = equalizerManager.resetToFlat()

    fun clearCache(onCleared: () -> Unit) {
        viewModelScope.launch {
            audioCacheProvider.clearCache()
            cacheSizeFlow.value = audioCacheProvider.getCacheSizeBytes()
            onCleared()
        }
    }

    fun clearOfflineDownloads(onCleared: (Int) -> Unit) {
        viewModelScope.launch {
            val removed = libraryRepository.clearAllDownloadedTracks()
            onCleared(removed)
        }
    }

    suspend fun generateBackupJson(): String = backupCoordinator.exportFullBackupJson()

    suspend fun generateProtectedBackupJson(password: String): String =
        backupCoordinator.exportProtectedBackupJson(password)

    fun isEncryptedBackup(payload: String): Boolean =
        backupCoordinator.isEncryptedBackup(payload)

    fun restoreBackupJson(json: String, onResult: (Result<BackupRestoreSummary>) -> Unit) {
        restoreBackupPayload(json, null, onResult)
    }

    fun restoreBackupPayload(
        payload: String,
        password: String? = null,
        onResult: (Result<BackupRestoreSummary>) -> Unit
    ) {
        viewModelScope.launch {
            val result = backupCoordinator.importBackupPayload(payload, password)
            onResult(result)
        }
    }

    suspend fun savePreUpdateBackupSnapshot(): Result<String> {
        val res = backupCoordinator.saveUpdateSnapshotToDownloads()
        res.onSuccess { path -> autoBackupLocationFlow.value = path }
        return res
    }

    fun saveBackupToDownloadsSnapshot(onResult: (Result<String>) -> Unit) {
        viewModelScope.launch {
            val res = savePreUpdateBackupSnapshot()
            onResult(res)
        }
    }

    fun executeSignOutWithOptions(
        unlinkAccount: Boolean,
        clearCache: Boolean,
        saveBackupToDownloads: Boolean,
        onComplete: (String) -> Unit
    ) {
        viewModelScope.launch {
            val summaryParts = mutableListOf<String>()
            if (saveBackupToDownloads) {
                savePreUpdateBackupSnapshot().onSuccess { path ->
                    summaryParts.add("копия: $path")
                }.onFailure {
                    summaryParts.add("ошибка бэкапа")
                }
            }
            if (clearCache) {
                audioCacheProvider.clearCache()
                cacheSizeFlow.value = audioCacheProvider.getCacheSizeBytes()
                summaryParts.add("кэш очищен")
            }
            if (unlinkAccount) {
                youTubeAccountRepository.signOutAll()
                summaryParts.add("аккаунт отвязан")
            }
            val msg = if (summaryParts.isEmpty()) {
                "Изменений не выбрано"
            } else {
                "Готово: ${summaryParts.joinToString(", ")}"
            }
            onComplete(msg)
        }
    }

    fun checkForUpdates(
        onMessage: (String) -> Unit,
        silentIfUpToDate: Boolean = false
    ) {
        if (updateStateFlow.value is AppUpdateUiState.Checking ||
            updateStateFlow.value is AppUpdateUiState.Downloading
        ) {
            return
        }
        viewModelScope.launch {
            updateStateFlow.value = AppUpdateUiState.Checking
            settingsRepository.setLastUpdateCheckAtMs(System.currentTimeMillis())
            when (val outcome = appUpdateRepository.checkForUpdate()) {
                is UpdateCheckOutcome.UpdateAvailable -> {
                    updateStateFlow.value = AppUpdateUiState.Available(outcome.info)
                }

                is UpdateCheckOutcome.UpToDate -> {
                    updateStateFlow.value = AppUpdateUiState.Idle
                    if (!silentIfUpToDate) {
                        onMessage("Установлена актуальная версия (${outcome.currentVersion})")
                    }
                }

                is UpdateCheckOutcome.Failure -> {
                    updateStateFlow.value = AppUpdateUiState.Idle
                    if (!silentIfUpToDate) {
                        onMessage(outcome.message)
                    }
                }
            }
        }
    }

    fun startUpdateDownload(
        info: AppUpdateInfo,
        onReadyToInstall: (File) -> Unit,
        onError: (String) -> Unit
    ) {
        updateDownloadJob?.cancel()
        updateDownloadJob = viewModelScope.launch {
            updateStateFlow.value = AppUpdateUiState.Downloading(
                info = info,
                progress = 0f,
                downloadedBytes = 0L,
                totalBytes = info.assetSizeBytes
            )
            savePreUpdateBackupSnapshot()
            try {
                appUpdateRepository.downloadApk(info).collect { event ->
                    when (event) {
                        is ApkDownloadEvent.Progress -> {
                            updateStateFlow.value = AppUpdateUiState.Downloading(
                                info = info,
                                progress = event.fraction,
                                downloadedBytes = event.downloadedBytes,
                                totalBytes = event.totalBytes
                            )
                        }

                        is ApkDownloadEvent.Completed -> {
                            updateStateFlow.value = AppUpdateUiState.ReadyToInstall(info, event.file)
                            onReadyToInstall(event.file)
                        }
                    }
                }
            } catch (e: CancellationException) {
                appUpdateRepository.clearCachedUpdates()
                updateStateFlow.value = AppUpdateUiState.Idle
                throw e
            } catch (e: Exception) {
                updateStateFlow.value = AppUpdateUiState.Available(info)
                onError(FriendlyErrorMapper.map(e, "Ошибка загрузки обновления"))
            }
        }
    }

    fun dismissUpdateDialog() {
        updateDownloadJob?.cancel()
        updateDownloadJob = null
        appUpdateRepository.clearCachedUpdates()
        updateStateFlow.value = AppUpdateUiState.Idle
    }

    private data class LibraryStorageStats(
        val offlineDownloadsBytes: Long,
        val offlineTracksCount: Int,
        val favoritesCount: Int,
        val playlistsCount: Int
    )
}
