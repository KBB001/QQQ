package com.example.data.local

import com.example.core.common.NetworkMonitor
import com.example.domain.repository.LibraryRepository
import com.example.domain.repository.SettingsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Watches [SettingsRepository.settings] (`autoDownloadFavoritesWifi`), [NetworkMonitor] Wi-Fi state,
 * and favorite tracks in [LibraryRepository]. When enabled on an unmetered Wi-Fi connection,
 * downloads any non-cached favorite tracks sequentially via [TrackDownloadManager].
 */
@Singleton
class FavoritesAutoDownloadManager @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val networkMonitor: NetworkMonitor,
    private val libraryRepository: LibraryRepository,
    private val trackDownloadManager: TrackDownloadManager
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val started = AtomicBoolean(false)
    private val failedThisCycleIds = ConcurrentHashMap.newKeySet<String>()
    private var downloadJob: Job? = null

    fun start() {
        if (!started.compareAndSet(false, true)) return

        scope.launch {
            combine(
                settingsRepository.settings,
                networkMonitor.isOnline,
                networkMonitor.isMetered,
                libraryRepository.observeFavorites(),
                libraryRepository.observeDownloadedIds()
            ) { settings, isOnline, isMetered, favorites, downloadedIds ->
                AutoDownloadSnapshot(
                    enabled = settings.autoDownloadFavoritesWifi,
                    canDownloadNow = settings.autoDownloadFavoritesWifi && isOnline && !isMetered,
                    pendingTracks = if (settings.autoDownloadFavoritesWifi && isOnline && !isMetered) {
                        favorites.filter { it.id !in downloadedIds }
                    } else {
                        emptyList()
                    }
                )
            }.distinctUntilChanged().collect { snapshot ->
                if (!snapshot.canDownloadNow) {
                    downloadJob?.cancel()
                    downloadJob = null
                    if (!snapshot.enabled) {
                        failedThisCycleIds.clear()
                    }
                    return@collect
                }

                val queue = snapshot.pendingTracks.filter { it.id !in failedThisCycleIds }
                if (queue.isEmpty()) return@collect

                if (downloadJob?.isActive == true) {
                    return@collect
                }

                downloadJob = scope.launch {
                    for (track in queue) {
                        val stillEnabled = runCatching {
                            settingsRepository.settings.first().autoDownloadFavoritesWifi
                        }.getOrDefault(false)
                        if (!stillEnabled || !networkMonitor.isOnline.value || networkMonitor.isMetered.value) {
                            break
                        }
                        val alreadyOffline = libraryRepository.getDownloadedFilePath(track.id) != null
                        if (alreadyOffline) continue

                        try {
                            trackDownloadManager.downloadTrack(track).onFailure {
                                failedThisCycleIds.add(track.id)
                            }
                        } catch (ce: CancellationException) {
                            throw ce
                        } catch (_: Exception) {
                            failedThisCycleIds.add(track.id)
                        }
                    }
                }
            }
        }
    }

    fun resetRetryState() {
        failedThisCycleIds.clear()
    }

    private data class AutoDownloadSnapshot(
        val enabled: Boolean,
        val canDownloadNow: Boolean,
        val pendingTracks: List<com.example.domain.model.Track>
    )
}
