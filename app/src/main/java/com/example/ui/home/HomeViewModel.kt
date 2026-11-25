package com.example.ui.home

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.common.DurationFormatter
import com.example.core.common.FriendlyErrorMapper
import com.example.core.common.NetworkMonitor
import com.example.data.local.TrackDownloadManager
import com.example.domain.model.PlaybackState
import com.example.domain.model.Playlist
import com.example.domain.model.Track
import com.example.domain.model.YouTubeAccount
import com.example.domain.recommendation.SmartRecommendationEngine
import com.example.domain.recommendation.TasteSignalTracker
import com.example.domain.recommendation.TrackMoodProfiler
import com.example.domain.repository.LibraryRepository
import com.example.domain.repository.YouTubeAccountRepository
import com.example.domain.repository.YouTubeRepository
import com.example.playback.PlaybackManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject

sealed interface DiscoverUiState {
    data object Loading : DiscoverUiState
    data class Success(
        val tracks: List<Track>,
        val isOfflineFallback: Boolean = false,
        val subtitle: String? = null
    ) : DiscoverUiState

    data class Empty(val mood: String) : DiscoverUiState
    data class Error(val message: String) : DiscoverUiState
}

@Immutable
data class HomeUiState(
    val selectedMood: String = MOOD_CHIPS.first(),
    val moods: List<String> = MOOD_CHIPS,
    val discoverState: DiscoverUiState = DiscoverUiState.Loading,
    val dailyMixTracks: List<Track> = emptyList(),
    val dailyMixSubtitle: String = "Бесконечный поток под ваш вкус",
    val isRefreshing: Boolean = false,
    val history: List<Track> = emptyList(),
    val favorites: List<Track> = emptyList(),
    val downloadedTracks: List<Track> = emptyList(),
    val quickPicks: List<Track> = emptyList(),
    val favoriteIds: Set<String> = emptySet(),
    val downloadedIds: Set<String> = emptySet(),
    val downloadingIds: Set<String> = emptySet(),
    val playlists: List<Playlist> = emptyList(),
    val playbackState: PlaybackState = PlaybackState(),
    val activeAccount: YouTubeAccount? = null,
    val isOnline: Boolean = true
) {
    companion object {
        const val MOOD_FOR_YOU = "Для тебя"

        val MOOD_CHIPS = listOf(
            MOOD_FOR_YOU,
            "Топ-чарты",
            "Lo-Fi биты",
            "Synthwave",
            "Акустика",
            "Глубокий фокус",
            "Электроника",
            "Инди-рок",
            "Джаз"
        )

        fun toSearchQuery(mood: String): String = when (mood) {
            "Топ-чарты" -> "Top Hits Mix music audio"
            "Lo-Fi биты" -> "Lo-Fi Beats chillhop music"
            "Synthwave" -> "Synthwave retrowave music"
            "Акустика" -> "Acoustic Chill indie guitar music"
            "Глубокий фокус" -> "Deep Focus ambient instrumental music"
            "Электроника" -> "Electronic dance chill house music"
            "Инди-рок" -> "Indie Rock alternative music"
            "Джаз" -> "Smooth Jazz cafe piano music"
            else -> "$mood music audio"
        }
    }
}

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val youTubeRepository: YouTubeRepository,
    private val libraryRepository: LibraryRepository,
    private val playbackManager: PlaybackManager,
    private val trackDownloadManager: TrackDownloadManager,
    private val youTubeAccountRepository: YouTubeAccountRepository,
    private val networkMonitor: NetworkMonitor,
    private val tasteSignalTracker: TasteSignalTracker,
    private val smartRecommendationEngine: SmartRecommendationEngine,
    private val moodProfiler: TrackMoodProfiler
) : ViewModel() {

    private val selectedMood = MutableStateFlow(HomeUiState.MOOD_CHIPS.first())
    private val discoverState = MutableStateFlow<DiscoverUiState>(DiscoverUiState.Loading)
    private val dailyMixTracks = MutableStateFlow<List<Track>>(emptyList())
    private val dailyMixSubtitle = MutableStateFlow("Бесконечный поток под ваш вкус")
    private val isRefreshing = MutableStateFlow(false)

    private val moodTrackCache = ConcurrentHashMap<String, DiscoverUiState.Success>()
    private var discoverJob: Job? = null
    private var refreshJob: Job? = null

    private val homeFeedFlow = combine(
        selectedMood,
        discoverState,
        dailyMixTracks,
        dailyMixSubtitle,
        isRefreshing
    ) { mood, discover, dailyMix, mixSubtitle, refreshing ->
        FeedSnapshot(
            selectedMood = mood,
            discoverState = discover,
            dailyMixTracks = dailyMix,
            dailyMixSubtitle = mixSubtitle,
            isRefreshing = refreshing
        )
    }

    private val librarySnapshotFlow = combine(
        libraryRepository.observeHistory(),
        libraryRepository.observeFavorites(),
        libraryRepository.observeDownloadedTracks(),
        libraryRepository.observeFavoriteIds(),
        libraryRepository.observeDownloadedIds(),
        trackDownloadManager.downloadingIds,
        libraryRepository.observePlaylists()
    ) { values ->
        @Suppress("UNCHECKED_CAST")
        LibrarySnapshot(
            history = values[0] as List<Track>,
            favorites = values[1] as List<Track>,
            downloads = values[2] as List<Track>,
            favoriteIds = values[3] as Set<String>,
            downloadedIds = values[4] as Set<String>,
            downloadingIds = values[5] as Set<String>,
            playlists = values[6] as List<Playlist>
        )
    }

    val uiState: StateFlow<HomeUiState> = combine(
        homeFeedFlow,
        librarySnapshotFlow,
        playbackManager.playbackState,
        youTubeAccountRepository.activeAccount,
        networkMonitor.isOnline
    ) { feed, library, playback, account, online ->
        val localQuickPool = buildList {
            if (!online) {
                addAll(library.downloads)
            } else {
                addAll(library.favorites.take(8))
                addAll(library.history.take(10))
                addAll(library.downloads.take(8))
            }
        }.distinctBy { it.id }
            .sortedByDescending { tasteSignalTracker.getPersonalAffinityBonus(it) }

        val discoverTracks = (feed.discoverState as? DiscoverUiState.Success)?.tracks.orEmpty()
        val quickPicks = if (localQuickPool.size >= 6 || !online) {
            localQuickPool.take(6)
        } else {
            val supplementSource = (feed.dailyMixTracks + discoverTracks).distinctBy { it.id }
            (localQuickPool + supplementSource)
                .distinctBy { it.id }
                .take(6)
        }

        val resolvedDailyMix = when {
            !online && library.downloads.isNotEmpty() -> library.downloads
            feed.dailyMixTracks.isNotEmpty() -> feed.dailyMixTracks
            discoverTracks.isNotEmpty() -> discoverTracks
            else -> localQuickPool
        }

        val resolvedMixSubtitle = when {
            !online && library.downloads.isNotEmpty() ->
                "Офлайн-волна • ${DurationFormatter.formatTrackCount(library.downloads.size)}"
            !online ->
                "Подключитесь к сети или скачайте треки"
            else -> feed.dailyMixSubtitle
        }

        HomeUiState(
            selectedMood = feed.selectedMood,
            discoverState = feed.discoverState,
            dailyMixTracks = resolvedDailyMix,
            dailyMixSubtitle = resolvedMixSubtitle,
            isRefreshing = feed.isRefreshing,
            history = library.history,
            favorites = library.favorites,
            downloadedTracks = library.downloads,
            quickPicks = quickPicks,
            favoriteIds = library.favoriteIds,
            downloadedIds = library.downloadedIds,
            downloadingIds = library.downloadingIds,
            playlists = library.playlists,
            playbackState = playback,
            activeAccount = account,
            isOnline = online
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = HomeUiState()
    )

    init {
        loadMoodTracks(HomeUiState.MOOD_CHIPS.first(), forceRefresh = false)
        viewModelScope.launch {
            var wasOnline = networkMonitor.isOnline.value
            networkMonitor.isOnline
                .collect { online ->
                    if (online && !wasOnline) {
                        val state = discoverState.value
                        if (state is DiscoverUiState.Error ||
                            (state is DiscoverUiState.Success && state.isOfflineFallback)
                        ) {
                            loadMoodTracks(selectedMood.value, forceRefresh = true)
                        }
                    } else if (!online && wasOnline) {
                        val downloads = runCatching { libraryRepository.observeDownloadedTracks().first() }
                            .getOrDefault(emptyList())
                        if (downloads.isNotEmpty()) {
                            discoverState.value = buildOfflineDiscoverState(selectedMood.value, downloads)
                        }
                    }
                    wasOnline = online
                }
        }
    }

    fun selectMood(mood: String) {
        if (selectedMood.value == mood && discoverState.value is DiscoverUiState.Success) return
        selectedMood.value = mood
        loadMoodTracks(mood, forceRefresh = false)
    }

    fun retryDiscover() {
        loadMoodTracks(selectedMood.value, forceRefresh = true)
    }

    fun refreshAll() {
        if (refreshJob?.isActive == true) return
        refreshJob = viewModelScope.launch {
            isRefreshing.value = true
            try {
                moodTrackCache.clear()
                val activeMood = selectedMood.value
                coroutineScope {
                    val mixJob = if (activeMood != HomeUiState.MOOD_FOR_YOU) {
                        async { fetchForYouState() }
                    } else {
                        null
                    }
                    val activeResult = fetchMoodState(activeMood)
                    discoverState.value = activeResult
                    if (activeMood == HomeUiState.MOOD_FOR_YOU && activeResult is DiscoverUiState.Success) {
                        moodTrackCache[HomeUiState.MOOD_FOR_YOU] = activeResult
                        dailyMixTracks.value = activeResult.tracks
                    } else if (activeResult is DiscoverUiState.Success) {
                        moodTrackCache[activeMood] = activeResult
                    }
                    mixJob?.await()?.let { mixState ->
                        if (mixState is DiscoverUiState.Success) {
                            moodTrackCache[HomeUiState.MOOD_FOR_YOU] = mixState
                            dailyMixTracks.value = mixState.tracks
                        }
                    }
                }
            } finally {
                isRefreshing.value = false
            }
        }
    }

    private fun loadMoodTracks(mood: String, forceRefresh: Boolean) {
        if (!forceRefresh) {
            val cached = moodTrackCache[mood]
            if (cached != null && (networkMonitor.isOnline.value || cached.isOfflineFallback)) {
                discoverState.value = cached
                return
            }
        }

        discoverJob?.cancel()
        discoverJob = viewModelScope.launch {
            discoverState.value = DiscoverUiState.Loading
            val resolvedState = fetchMoodState(mood)
            discoverState.value = resolvedState
            if (resolvedState is DiscoverUiState.Success) {
                moodTrackCache[mood] = resolvedState
                if (mood == HomeUiState.MOOD_FOR_YOU && !resolvedState.isOfflineFallback) {
                    dailyMixTracks.value = resolvedState.tracks
                }
            }
        }
    }

    private suspend fun fetchMoodState(mood: String): DiscoverUiState {
        return if (mood == HomeUiState.MOOD_FOR_YOU) {
            fetchForYouState()
        } else {
            fetchCuratedMoodState(mood)
        }
    }

    private suspend fun fetchForYouState(): DiscoverUiState {
        tasteSignalTracker.ensureHydrated()
        val favorites = runCatching { libraryRepository.observeFavorites().first() }.getOrDefault(emptyList())
        val history = runCatching { libraryRepository.observeHistory().first() }.getOrDefault(emptyList())
        val downloads = runCatching { libraryRepository.observeDownloadedTracks().first() }.getOrDefault(emptyList())

        if (!networkMonitor.isOnline.value) {
            return if (downloads.isNotEmpty()) {
                buildOfflineDiscoverState(HomeUiState.MOOD_FOR_YOU, downloads)
            } else {
                DiscoverUiState.Error("Нет подключения к интернету")
            }
        }

        val candidates = LinkedHashMap<String, Track>()
        val seedTrack = favorites.firstOrNull() ?: history.firstOrNull()
        val preferredMood = tasteSignalTracker.topPreferredMood()

        if (seedTrack != null) {
            val smartTracks = runCatching {
                smartRecommendationEngine.generateNextQueueTracks(
                    seedTrack = seedTrack,
                    targetCount = 15,
                    excludeIds = emptySet()
                )
            }.getOrDefault(emptyList())
            smartTracks.forEach { candidates.putIfAbsent(it.id, it) }
        }

        if (candidates.size < 12) {
            val fallbackQuery = if (preferredMood != null) {
                moodProfiler.searchQueryForMood(preferredMood)
            } else {
                HomeUiState.toSearchQuery("Топ-чарты")
            }
            val searchResult = youTubeRepository.searchTracks(fallbackQuery)
            if (searchResult.isFailure && candidates.isEmpty()) {
                val error = searchResult.exceptionOrNull()
                if (downloads.isNotEmpty()) {
                    return buildOfflineDiscoverState(HomeUiState.MOOD_FOR_YOU, downloads)
                }
                return DiscoverUiState.Error(
                    FriendlyErrorMapper.map(
                        error ?: IllegalStateException("Network error"),
                        "Не удалось подключиться к YouTube."
                    )
                )
            }
            searchResult.getOrDefault(emptyList()).forEach { track ->
                candidates.putIfAbsent(track.id, track)
            }
        }

        val ranked = candidates.values
            .take(18)
            .withIndex()
            .sortedByDescending { (idx, track) ->
                val relevanceScore = (18 - idx) * 0.045f
                relevanceScore + tasteSignalTracker.getPersonalAffinityBonus(track)
            }
            .map { it.value }

        if (ranked.isEmpty()) {
            return if (downloads.isNotEmpty()) {
                buildOfflineDiscoverState(HomeUiState.MOOD_FOR_YOU, downloads)
            } else {
                DiscoverUiState.Empty(HomeUiState.MOOD_FOR_YOU)
            }
        }

        val mixSummary = when {
            seedTrack != null -> "В стиле ${seedTrack.artist} • ${DurationFormatter.formatTrackCount(ranked.size)}"
            preferredMood != null -> "Персональный микс • ${DurationFormatter.formatTrackCount(ranked.size)}"
            else -> "Подборка дня • ${DurationFormatter.formatTrackCount(ranked.size)}"
        }
        dailyMixSubtitle.value = mixSummary
        dailyMixTracks.value = ranked

        return DiscoverUiState.Success(
            tracks = ranked,
            isOfflineFallback = false,
            subtitle = mixSummary
        )
    }

    private suspend fun fetchCuratedMoodState(mood: String): DiscoverUiState {
        val downloads = runCatching { libraryRepository.observeDownloadedTracks().first() }.getOrDefault(emptyList())

        if (!networkMonitor.isOnline.value) {
            return if (downloads.isNotEmpty()) {
                buildOfflineDiscoverState(mood, downloads)
            } else {
                DiscoverUiState.Error("Нет подключения к интернету")
            }
        }

        return try {
            val result = youTubeRepository.searchTracks(HomeUiState.toSearchQuery(mood))
            result.fold(
                onSuccess = { tracks ->
                    tasteSignalTracker.ensureHydrated()
                    val ranked = tracks.take(16)
                        .withIndex()
                        .sortedByDescending { (idx, track) ->
                            val relevanceScore = (16 - idx) * 0.05f
                            relevanceScore + tasteSignalTracker.getPersonalAffinityBonus(track)
                        }
                        .map { it.value }

                    if (ranked.isEmpty()) {
                        DiscoverUiState.Empty(mood)
                    } else {
                        DiscoverUiState.Success(tracks = ranked, isOfflineFallback = false)
                    }
                },
                onFailure = { error ->
                    if (downloads.isNotEmpty() && !networkMonitor.isOnline.value) {
                        buildOfflineDiscoverState(mood, downloads)
                    } else {
                        DiscoverUiState.Error(
                            FriendlyErrorMapper.map(error, "Не удалось подключиться к YouTube.")
                        )
                    }
                }
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            DiscoverUiState.Error(
                FriendlyErrorMapper.map(e, "Не удалось загрузить подборку.")
            )
        }
    }

    private fun buildOfflineDiscoverState(mood: String, downloads: List<Track>): DiscoverUiState.Success {
        val sorted = downloads.sortedByDescending { tasteSignalTracker.getPersonalAffinityBonus(it) }
        val filtered = if (mood == HomeUiState.MOOD_FOR_YOU || mood == "Топ-чарты") {
            sorted
        } else {
            val queryTokens = mood.lowercase().split(" ", "-").filter { it.length >= 3 }
            val matching = sorted.filter { track ->
                val haystack = "${track.title} ${track.artist}".lowercase()
                queryTokens.any { haystack.contains(it) }
            }
            matching.ifEmpty { sorted }
        }
        return DiscoverUiState.Success(
            tracks = filtered,
            isOfflineFallback = true,
            subtitle = "Офлайн-подборка • ${DurationFormatter.formatTrackCount(filtered.size)}"
        )
    }

    fun playTrack(track: Track, queue: List<Track>) {
        val resolvedQueue = queue.ifEmpty { listOf(track) }
        playbackManager.playTrack(track, resolvedQueue)
    }

    fun playQuickPick(track: Track) {
        val state = uiState.value
        val fullQueue = buildList {
            addAll(state.quickPicks)
            addAll(state.dailyMixTracks)
            val discoverTracks = (state.discoverState as? DiscoverUiState.Success)?.tracks.orEmpty()
            addAll(discoverTracks)
        }.distinctBy { it.id }
            .let { list ->
                if (!state.isOnline) {
                    val offlineOnly = list.filter { it.id in state.downloadedIds || it.id == track.id }
                    offlineOnly.ifEmpty { list }
                } else {
                    list
                }
            }
        playbackManager.playTrack(track, fullQueue.ifEmpty { listOf(track) })
    }

    fun playMix(shuffle: Boolean = false, onUnavailable: ((String) -> Unit)? = null) {
        val state = uiState.value
        val discoverTracks = (state.discoverState as? DiscoverUiState.Success)?.tracks.orEmpty()
        val source = if (!state.isOnline) {
            state.downloadedTracks
        } else {
            discoverTracks.ifEmpty {
                state.dailyMixTracks.ifEmpty {
                    state.quickPicks.ifEmpty { state.downloadedTracks }
                }
            }
        }
        if (source.isEmpty()) {
            onUnavailable?.invoke("Подборка пока пуста. Проверьте интернет или откройте Поиск.")
            return
        }
        val queue = if (shuffle) source.shuffled() else source
        playbackManager.playTrack(queue.first(), queue)
    }

    fun playDailyMix(shuffle: Boolean = false, onEmpty: () -> Unit = {}) {
        val state = uiState.value
        val source = if (!state.isOnline) {
            state.downloadedTracks
        } else {
            state.dailyMixTracks.ifEmpty {
                (state.discoverState as? DiscoverUiState.Success)?.tracks.orEmpty()
                    .ifEmpty { state.quickPicks }
                    .ifEmpty { state.favorites }
                    .ifEmpty { state.history }
                    .ifEmpty { state.downloadedTracks }
            }
        }
        if (source.isEmpty()) {
            onEmpty()
            return
        }
        val queue = if (shuffle) source.shuffled() else source
        playbackManager.playTrack(queue.first(), queue)
    }

    fun resumeLastTrack(onEmpty: () -> Unit = {}) {
        val state = uiState.value
        if (state.playbackState.currentTrack != null) {
            playbackManager.togglePlayPause()
            return
        }
        val historyQueue = if (!state.isOnline) {
            state.history.filter { it.id in state.downloadedIds }.ifEmpty { state.downloadedTracks }
        } else {
            state.history
        }
        val first = historyQueue.firstOrNull()
        if (first != null) {
            playbackManager.playTrack(first, historyQueue)
        } else {
            playDailyMix(shuffle = false, onEmpty = onEmpty)
        }
    }

    fun handleHeroPrimaryClick(onEmpty: () -> Unit = {}) {
        val state = uiState.value
        if (state.playbackState.currentTrack != null) {
            playbackManager.togglePlayPause()
        } else {
            playDailyMix(shuffle = false, onEmpty = onEmpty)
        }
    }

    fun playOfflineMix(onUnavailable: ((String) -> Unit)? = null) {
        val offline = uiState.value.downloadedTracks
        if (offline.isEmpty()) {
            onUnavailable?.invoke("Нет скачанных треков для офлайн-микса")
            return
        }
        val shuffled = offline.shuffled()
        playbackManager.playTrack(shuffled.first(), shuffled)
    }

    fun playNext(track: Track) {
        playbackManager.playNext(track)
    }

    fun startTrackRadio(track: Track, onNotice: (String) -> Unit) {
        onNotice("Подбираем радио по треку...")
        playbackManager.startTrackRadio(track) { result ->
            result.onSuccess { added ->
                onNotice("Радио запущено: +$added треков")
            }.onFailure { err ->
                onNotice(FriendlyErrorMapper.map(err, "Не удалось запустить радио"))
            }
        }
    }

    fun toggleFavorite(track: Track) {
        viewModelScope.launch {
            libraryRepository.toggleFavorite(track)
        }
    }

    fun toggleDownload(track: Track, onNotice: (String) -> Unit) {
        viewModelScope.launch {
            if (track.id in uiState.value.downloadedIds) {
                trackDownloadManager.removeDownload(track.id)
                onNotice("Офлайн-копия удалена")
            } else {
                onNotice("Загрузка «${track.title}»...")
                trackDownloadManager.downloadTrack(track).onSuccess {
                    onNotice("Сохранено для офлайн-прослушивания")
                }.onFailure { err ->
                    onNotice(FriendlyErrorMapper.map(err, "Ошибка загрузки"))
                }
            }
        }
    }

    fun addTrackToPlaylist(playlistId: Long, track: Track) {
        viewModelScope.launch {
            libraryRepository.addTrackToPlaylist(playlistId, track)
        }
    }

    fun createPlaylistAndAddTrack(name: String, track: Track) {
        viewModelScope.launch {
            libraryRepository.createPlaylist(name = name, initialTracks = listOf(track))
        }
    }

    private data class FeedSnapshot(
        val selectedMood: String,
        val discoverState: DiscoverUiState,
        val dailyMixTracks: List<Track>,
        val dailyMixSubtitle: String,
        val isRefreshing: Boolean
    )

    private data class LibrarySnapshot(
        val history: List<Track>,
        val favorites: List<Track>,
        val downloads: List<Track>,
        val favoriteIds: Set<String>,
        val downloadedIds: Set<String>,
        val downloadingIds: Set<String>,
        val playlists: List<Playlist>
    )
}
