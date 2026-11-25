package com.example.ui.search

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.common.FriendlyErrorMapper
import com.example.core.common.NetworkMonitor
import com.example.data.local.TrackDownloadManager
import com.example.domain.model.PlaybackState
import com.example.domain.model.Playlist
import com.example.domain.model.SearchFilter
import com.example.domain.model.Track
import com.example.domain.model.YouTubeArtistSummary
import com.example.domain.model.YouTubePlaylistSummary
import com.example.domain.repository.LibraryRepository
import com.example.domain.repository.YouTubeRepository
import com.example.playback.PlaybackManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface SearchResultsState {
    data object Idle : SearchResultsState
    data object Loading : SearchResultsState
    data class Tracks(
        val items: List<Track>,
        val playlistTitle: String? = null,
        val headerSubtitle: String? = null,
        val isArtistCollection: Boolean = false
    ) : SearchResultsState

    data class Playlists(val items: List<YouTubePlaylistSummary>) : SearchResultsState
    data class Artists(val items: List<YouTubeArtistSummary>) : SearchResultsState
    data class Error(
        val message: String,
        val isNetworkError: Boolean = false
    ) : SearchResultsState
}

@Immutable
data class SearchUiState(
    val query: String = "",
    val selectedFilter: SearchFilter = SearchFilter.TRACKS,
    val suggestions: List<String> = emptyList(),
    val localMatches: List<Track> = emptyList(),
    val localPlaylistMatches: List<Playlist> = emptyList(),
    val searchHistory: List<String> = emptyList(),
    val resultsState: SearchResultsState = SearchResultsState.Idle,
    val canNavigateBackInResults: Boolean = false,
    val favoriteIds: Set<String> = emptySet(),
    val downloadedIds: Set<String> = emptySet(),
    val downloadingIds: Set<String> = emptySet(),
    val playlists: List<Playlist> = emptyList(),
    val playbackState: PlaybackState = PlaybackState(),
    val isOnline: Boolean = true
)

@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val youTubeRepository: YouTubeRepository,
    private val libraryRepository: LibraryRepository,
    private val playbackManager: PlaybackManager,
    private val trackDownloadManager: TrackDownloadManager,
    private val networkMonitor: NetworkMonitor
) : ViewModel() {

    private val queryFlow = MutableStateFlow("")
    private val filterFlow = MutableStateFlow(SearchFilter.TRACKS)
    private val resultsFlow = MutableStateFlow<SearchResultsState>(SearchResultsState.Idle)
    private val previousResultsStackFlow = MutableStateFlow<List<SearchResultsState>>(emptyList())
    private val suppressSuggestionsFlow = MutableStateFlow(false)
    private var searchJob: Job? = null

    private val suggestionsFlow = combine(
        queryFlow.map { it.trim() },
        suppressSuggestionsFlow,
        networkMonitor.isOnline
    ) { trimmed, suppressed, isOnline ->
        if (!isOnline || suppressed || trimmed.length < 2 || isYouTubeUrl(trimmed)) "" else trimmed
    }
        .debounce(220L)
        .distinctUntilChanged()
        .flatMapLatest { target ->
            if (target.isEmpty()) {
                flowOf(emptyList())
            } else {
                flow {
                    emit(youTubeRepository.getSearchSuggestions(target))
                }
            }
        }

    // Instant local matches across Downloads, Favorites, History, and Playlists (0ms, works offline)
    private val localMatchesFlow = combine(
        queryFlow.map { it.trim().lowercase() }.distinctUntilChanged(),
        libraryRepository.observeDownloadedTracks(),
        libraryRepository.observeFavorites(),
        libraryRepository.observeHistory()
    ) { normalizedQuery, downloads, favorites, history ->
        if (normalizedQuery.isEmpty() || isYouTubeUrl(normalizedQuery)) {
            emptyList()
        } else {
            val combined = (downloads + favorites + history).distinctBy { it.id }
            val prefixMatches = combined.filter { track ->
                track.title.startsWith(normalizedQuery, ignoreCase = true) ||
                    track.artist.startsWith(normalizedQuery, ignoreCase = true)
            }
            val containsMatches = combined.filter { track ->
                track !in prefixMatches && (
                    track.title.contains(normalizedQuery, ignoreCase = true) ||
                        track.artist.contains(normalizedQuery, ignoreCase = true)
                    )
            }
            (prefixMatches + containsMatches).take(10)
        }
    }.flowOn(Dispatchers.Default)

    private val localPlaylistMatchesFlow = combine(
        queryFlow.map { it.trim().lowercase() }.distinctUntilChanged(),
        libraryRepository.observePlaylists()
    ) { normalizedQuery, playlists ->
        if (normalizedQuery.isEmpty() || isYouTubeUrl(normalizedQuery)) {
            emptyList()
        } else {
            val prefix = playlists.filter { it.name.startsWith(normalizedQuery, ignoreCase = true) }
            val contains = playlists.filter {
                it !in prefix && (
                    it.name.contains(normalizedQuery, ignoreCase = true) ||
                        it.description.contains(normalizedQuery, ignoreCase = true)
                    )
            }
            (prefix + contains).take(6)
        }
    }.flowOn(Dispatchers.Default)

    private val filteredHistoryFlow = combine(
        queryFlow.map { it.trim() }.distinctUntilChanged(),
        libraryRepository.observeSearchHistory()
    ) { trimmed, history ->
        if (trimmed.isEmpty()) {
            history
        } else {
            val prefixMatches = history.filter { it.startsWith(trimmed, ignoreCase = true) }
            val otherMatches = history.filter {
                !it.startsWith(trimmed, ignoreCase = true) && it.contains(trimmed, ignoreCase = true)
            }
            (prefixMatches + otherMatches).take(6)
        }
    }.flowOn(Dispatchers.Default)

    private val librarySignalsFlow = combine(
        libraryRepository.observeFavoriteIds(),
        libraryRepository.observeDownloadedIds(),
        trackDownloadManager.downloadingIds,
        libraryRepository.observePlaylists(),
        playbackManager.playbackState
    ) { favoriteIds, downloadedIds, downloadingIds, playlists, playbackState ->
        LibrarySignals(
            favoriteIds = favoriteIds,
            downloadedIds = downloadedIds,
            downloadingIds = downloadingIds,
            playlists = playlists,
            playbackState = playbackState
        )
    }

    private val searchInputsFlow = combine(
        queryFlow,
        filterFlow,
        suggestionsFlow,
        localMatchesFlow,
        filteredHistoryFlow
    ) { query, filter, suggestions, localMatches, searchHistory ->
        SearchInputs(
            query = query,
            filter = filter,
            suggestions = suggestions,
            localMatches = localMatches,
            searchHistory = searchHistory
        )
    }

    val uiState: StateFlow<SearchUiState> = combine(
        searchInputsFlow,
        localPlaylistMatchesFlow,
        resultsFlow,
        previousResultsStackFlow,
        combine(librarySignalsFlow, networkMonitor.isOnline) { signals, online -> signals to online }
    ) { inputs, localPlaylists, resultsState, backStack, (signals, isOnline) ->
        SearchUiState(
            query = inputs.query,
            selectedFilter = inputs.filter,
            suggestions = inputs.suggestions,
            localMatches = inputs.localMatches,
            localPlaylistMatches = localPlaylists,
            searchHistory = inputs.searchHistory,
            resultsState = resultsState,
            canNavigateBackInResults = backStack.isNotEmpty(),
            favoriteIds = signals.favoriteIds,
            downloadedIds = signals.downloadedIds,
            downloadingIds = signals.downloadingIds,
            playlists = signals.playlists,
            playbackState = signals.playbackState,
            isOnline = isOnline
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = SearchUiState()
    )

    fun onQueryChange(newQuery: String) {
        suppressSuggestionsFlow.value = false
        queryFlow.value = newQuery
        if (newQuery.isBlank()) {
            searchJob?.cancel()
            previousResultsStackFlow.value = emptyList()
            resultsFlow.value = SearchResultsState.Idle
        } else if (resultsFlow.value !is SearchResultsState.Idle) {
            previousResultsStackFlow.value = emptyList()
            resultsFlow.value = SearchResultsState.Idle
        }
    }

    fun fillQueryFromSuggestion(suggestion: String) {
        suppressSuggestionsFlow.value = false
        queryFlow.value = "$suggestion "
        previousResultsStackFlow.value = emptyList()
        resultsFlow.value = SearchResultsState.Idle
    }

    fun selectFilter(filter: SearchFilter) {
        if (filterFlow.value == filter) return
        filterFlow.value = filter
        if (queryFlow.value.isNotBlank() && resultsFlow.value !is SearchResultsState.Idle) {
            submitSearch()
        }
    }

    fun submitSearch(overrideQuery: String? = null) {
        val target = (overrideQuery ?: queryFlow.value).trim()
        suppressSuggestionsFlow.value = true
        if (overrideQuery != null) {
            queryFlow.value = target
        }
        if (target.isEmpty()) return

        searchJob?.cancel()
        previousResultsStackFlow.value = emptyList()

        if (!networkMonitor.isOnline.value) {
            resultsFlow.value = SearchResultsState.Error(
                message = "Нет подключения к интернету. Проверьте Wi-Fi или мобильную сеть и попробуйте снова.",
                isNetworkError = true
            )
            return
        }

        searchJob = viewModelScope.launch {
            resultsFlow.value = SearchResultsState.Loading
            if (!isYouTubeUrl(target)) {
                libraryRepository.recordSearchQuery(target)
            }

            if (isYouTubePlaylistUrl(target)) {
                youTubeRepository.getPlaylistWithTitle(target).fold(
                    onSuccess = { (title, tracks) ->
                        resultsFlow.value = SearchResultsState.Tracks(
                            items = tracks,
                            playlistTitle = title,
                            headerSubtitle = "Плейлист YouTube"
                        )
                    },
                    onFailure = { error ->
                        resultsFlow.value = toErrorState(error, "Не удалось загрузить плейлист YouTube")
                    }
                )
            } else {
                when (filterFlow.value) {
                    SearchFilter.TRACKS -> {
                        youTubeRepository.searchTracks(target).fold(
                            onSuccess = { resultsFlow.value = SearchResultsState.Tracks(it) },
                            onFailure = { err ->
                                resultsFlow.value = toErrorState(err, "Ошибка поиска треков.")
                            }
                        )
                    }
                    SearchFilter.PLAYLISTS -> {
                        youTubeRepository.searchPlaylists(target).fold(
                            onSuccess = { resultsFlow.value = SearchResultsState.Playlists(it) },
                            onFailure = { err ->
                                resultsFlow.value = toErrorState(err, "Ошибка поиска плейлистов.")
                            }
                        )
                    }
                    SearchFilter.ARTISTS -> {
                        youTubeRepository.searchArtists(target).fold(
                            onSuccess = { resultsFlow.value = SearchResultsState.Artists(it) },
                            onFailure = { err ->
                                resultsFlow.value = toErrorState(err, "Ошибка поиска исполнителей.")
                            }
                        )
                    }
                }
            }
        }
    }

    fun openPlaylistSummary(summary: YouTubePlaylistSummary) {
        val current = resultsFlow.value
        if (current is SearchResultsState.Playlists || current is SearchResultsState.Artists) {
            previousResultsStackFlow.value = previousResultsStackFlow.value + current
        }
        if (!networkMonitor.isOnline.value) {
            resultsFlow.value = SearchResultsState.Error(
                message = "Нет подключения к интернету. Проверьте сеть и попробуйте открыть плейлист снова.",
                isNetworkError = true
            )
            return
        }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            resultsFlow.value = SearchResultsState.Loading
            youTubeRepository.getPlaylistWithTitle(summary.url).fold(
                onSuccess = { (title, tracks) ->
                    resultsFlow.value = SearchResultsState.Tracks(
                        items = tracks,
                        playlistTitle = title,
                        headerSubtitle = summary.uploaderName.takeIf { it.isNotBlank() } ?: "Плейлист YouTube"
                    )
                },
                onFailure = { err ->
                    resultsFlow.value = toErrorState(err, "Не удалось открыть плейлист")
                }
            )
        }
    }

    fun openArtistSummary(artist: YouTubeArtistSummary) {
        val current = resultsFlow.value
        if (current is SearchResultsState.Artists || current is SearchResultsState.Playlists) {
            previousResultsStackFlow.value = previousResultsStackFlow.value + current
        }
        if (!networkMonitor.isOnline.value) {
            resultsFlow.value = SearchResultsState.Error(
                message = "Нет подключения к интернету. Проверьте сеть и повторите попытку.",
                isNetworkError = true
            )
            return
        }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            resultsFlow.value = SearchResultsState.Loading
            youTubeRepository.getArtistTracks(artist.url).fold(
                onSuccess = { tracks ->
                    resultsFlow.value = SearchResultsState.Tracks(
                        items = tracks,
                        playlistTitle = artist.name,
                        headerSubtitle = "Популярные треки исполнителя",
                        isArtistCollection = true
                    )
                },
                onFailure = { err ->
                    resultsFlow.value = toErrorState(err, "Не удалось загрузить треки артиста")
                }
            )
        }
    }

    fun navigateBackInResults(): Boolean {
        val stack = previousResultsStackFlow.value
        if (stack.isEmpty()) return false
        searchJob?.cancel()
        resultsFlow.value = stack.last()
        previousResultsStackFlow.value = stack.dropLast(1)
        return true
    }

    fun deleteSearchQuery(query: String) {
        viewModelScope.launch { libraryRepository.deleteSearchQuery(query) }
    }

    fun clearSearchHistory() {
        viewModelScope.launch { libraryRepository.clearSearchHistory() }
    }

    fun saveLoadedPlaylistToLibrary(title: String, tracks: List<Track>, onDone: (String) -> Unit) {
        if (tracks.isEmpty()) return
        viewModelScope.launch {
            libraryRepository.createPlaylist(
                name = title,
                description = "Импортировано из YouTube",
                initialTracks = tracks
            )
            onDone("Плейлист «$title» сохранён в медиатеку")
        }
    }

    fun playAll(tracks: List<Track>, shuffle: Boolean = false) {
        if (tracks.isEmpty()) return
        val queue = if (shuffle) tracks.shuffled() else tracks
        playbackManager.playTrack(queue.first(), queue)
    }

    fun playTrack(track: Track, queue: List<Track>) {
        playbackManager.playTrack(track, queue)
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
        viewModelScope.launch { libraryRepository.toggleFavorite(track) }
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
        viewModelScope.launch { libraryRepository.addTrackToPlaylist(playlistId, track) }
    }

    fun createPlaylistAndAddTrack(name: String, track: Track) {
        viewModelScope.launch {
            libraryRepository.createPlaylist(name = name, initialTracks = listOf(track))
        }
    }

    private fun toErrorState(error: Throwable, fallback: String): SearchResultsState.Error {
        val friendly = FriendlyErrorMapper.map(error, fallback)
        val isNet = !networkMonitor.isOnline.value ||
            friendly.contains("интернет", ignoreCase = true) ||
            friendly.contains("подключ", ignoreCase = true) ||
            friendly.contains("долго не отвечает", ignoreCase = true)
        return SearchResultsState.Error(message = friendly, isNetworkError = isNet)
    }

    companion object {
        fun isYouTubeUrl(input: String): Boolean {
            val lower = input.trim().lowercase()
            return lower.contains("youtube.com/") ||
                lower.contains("music.youtube.com/") ||
                lower.contains("youtu.be/")
        }

        fun isYouTubePlaylistUrl(input: String): Boolean {
            val lower = input.trim().lowercase()
            return (lower.contains("youtube.com") || lower.contains("music.youtube.com")) &&
                lower.contains("list=")
        }
    }

    private data class SearchInputs(
        val query: String,
        val filter: SearchFilter,
        val suggestions: List<String>,
        val localMatches: List<Track>,
        val searchHistory: List<String>
    )

    private data class LibrarySignals(
        val favoriteIds: Set<String>,
        val downloadedIds: Set<String>,
        val downloadingIds: Set<String>,
        val playlists: List<Playlist>,
        val playbackState: PlaybackState
    )
}
