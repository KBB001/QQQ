package com.example.ui.library

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.example.R
import com.example.domain.model.Playlist
import com.example.domain.model.Track
import com.example.ui.account.LibraryAccountSyncBanner
import com.example.ui.account.YouTubeAccountViewModel
import com.example.ui.components.AddToPlaylistDialog
import com.example.ui.components.CreatePlaylistDialog
import com.example.ui.components.ImportYouTubePlaylistDialog
import com.example.ui.components.SonoraFilterPill
import com.example.ui.components.SonoraIcons
import com.example.ui.components.SonoraPillBadge
import com.example.ui.components.TrackRowItem

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
fun LibraryScreen(
    onOpenPlaylist: (Long) -> Unit,
    onOpenYouTubeLogin: () -> Unit,
    bottomContentPadding: PaddingValues,
    onShowMessage: (String) -> Unit,
    requestedTab: Int? = null,
    onConsumeRequestedTab: () -> Unit = {},
    viewModel: LibraryViewModel = hiltViewModel(),
    accountViewModel: YouTubeAccountViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val accountUiState by accountViewModel.uiState.collectAsStateWithLifecycle()
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    var filterQuery by rememberSaveable { mutableStateOf("") }
    var showFilterBar by rememberSaveable { mutableStateOf(true) }
    var showCreatePlaylistDialog by remember { mutableStateOf(false) }
    var showImportDialog by remember { mutableStateOf(false) }
    var showClearHistoryConfirm by remember { mutableStateOf(false) }
    var showYouTubeCollectionSheet by remember { mutableStateOf(false) }
    var trackForPlaylistDialog by remember { mutableStateOf<Track?>(null) }
    var playlistPendingDelete by remember { mutableStateOf<Playlist?>(null) }

    LaunchedEffect(requestedTab) {
        if (requestedTab != null && requestedTab in 0..3) {
            selectedTab = requestedTab
            onConsumeRequestedTab()
        }
    }

    if (showCreatePlaylistDialog) {
        CreatePlaylistDialog(
            onDismiss = { showCreatePlaylistDialog = false },
            onCreate = { name, desc ->
                viewModel.createPlaylist(name, desc)
                showCreatePlaylistDialog = false
                onShowMessage("Плейлист «$name» создан")
            }
        )
    }

    if (showImportDialog) {
        ImportYouTubePlaylistDialog(
            isLoading = uiState.isImportingPlaylist,
            errorMessage = uiState.importError,
            onDismiss = {
                viewModel.clearImportError()
                showImportDialog = false
            },
            onImport = { url ->
                viewModel.importYouTubePlaylist(url) {
                    showImportDialog = false
                    onShowMessage("Плейлист YouTube импортирован")
                }
            }
        )
    }

    playlistPendingDelete?.let { playlist ->
        AlertDialog(
            onDismissRequest = { playlistPendingDelete = null },
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            title = { Text("Удалить плейлист?") },
            text = {
                Text("Плейлист «${playlist.name}» будет удалён из медиатеки устройства.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.deletePlaylist(playlist.id)
                        onShowMessage("Плейлист «${playlist.name}» удалён")
                        playlistPendingDelete = null
                    },
                    shape = CircleShape
                ) {
                    Text("Удалить")
                }
            },
            dismissButton = {
                TextButton(onClick = { playlistPendingDelete = null }) {
                    Text("Отмена")
                }
            }
        )
    }

    if (showClearHistoryConfirm) {
        AlertDialog(
            onDismissRequest = { showClearHistoryConfirm = false },
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            title = { Text("Очистить историю?") },
            text = {
                Text("Список недавно прослушанных треков на устройстве будет очищен.")
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.clearHistory()
                        showClearHistoryConfirm = false
                        onShowMessage("История прослушивания очищена")
                    },
                    shape = CircleShape
                ) {
                    Text("Очистить")
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearHistoryConfirm = false }) {
                    Text("Отмена")
                }
            }
        )
    }

    trackForPlaylistDialog?.let { selectedTrack ->
        AddToPlaylistDialog(
            track = selectedTrack,
            playlists = uiState.playlists,
            onDismiss = { trackForPlaylistDialog = null },
            onSelectPlaylist = { playlistId ->
                viewModel.addTrackToPlaylist(playlistId, selectedTrack)
                trackForPlaylistDialog = null
                onShowMessage("Трек добавлен в плейлист")
            },
            onCreateNewPlaylistAndAdd = { name ->
                viewModel.createPlaylistAndAddTrack(name, selectedTrack)
                trackForPlaylistDialog = null
                onShowMessage("Плейлист «$name» создан")
            }
        )
    }

    val syncedYouTubePlaylists = remember(uiState.playlists) {
        uiState.playlists.filter { !it.youtubePlaylistId.isNullOrBlank() }
    }

    if (showYouTubeCollectionSheet) {
        ModalBottomSheet(
            onDismissRequest = { showYouTubeCollectionSheet = false },
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Плейлисты YouTube Music",
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                    )
                    TextButton(
                        onClick = {
                            showYouTubeCollectionSheet = false
                            accountViewModel.syncAndMergeActiveAccount(onShowMessage)
                        }
                    ) {
                        Text("Обновить")
                    }
                }
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    items(syncedYouTubePlaylists, key = { it.id }) { ytPlaylist ->
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .clickable {
                                    showYouTubeCollectionSheet = false
                                    onOpenPlaylist(ytPlaylist.id)
                                },
                            color = MaterialTheme.colorScheme.surfaceContainerLow,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f))
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                AsyncImage(
                                    model = ytPlaylist.coverUrl,
                                    contentDescription = ytPlaylist.name,
                                    placeholder = painterResource(R.drawable.img_default_cover),
                                    error = painterResource(R.drawable.img_default_cover),
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .size(48.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                )
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = ytPlaylist.name,
                                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Text(
                                        text = "${ytPlaylist.trackCount} треков",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                }
                                Icon(
                                    imageVector = Icons.Rounded.PlayArrow,
                                    contentDescription = "Открыть плейлист",
                                    tint = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    val normalizedFilter = filterQuery.trim()
    val filteredPlaylists = remember(uiState.playlists, normalizedFilter) {
        if (normalizedFilter.isEmpty()) uiState.playlists
        else uiState.playlists.filter {
            it.name.contains(normalizedFilter, ignoreCase = true) ||
                it.description.contains(normalizedFilter, ignoreCase = true)
        }
    }
    val filteredFavorites = remember(uiState.favorites, normalizedFilter) {
        filterTracks(uiState.favorites, normalizedFilter)
    }
    val filteredDownloads = remember(uiState.downloads, normalizedFilter) {
        filterTracks(uiState.downloads, normalizedFilter)
    }
    val filteredHistory = remember(uiState.history, normalizedFilter) {
        filterTracks(uiState.history, normalizedFilter)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        Spacer(modifier = Modifier.height(12.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Медиатека",
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )

            Row(
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(
                    onClick = {
                        showFilterBar = !showFilterBar
                        if (!showFilterBar) filterQuery = ""
                    },
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("library_filter_toggle")
                ) {
                    Icon(
                        imageVector = SonoraIcons.FilterList,
                        contentDescription = "Фильтр медиатеки",
                        tint = if (showFilterBar || filterQuery.isNotEmpty()) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                }

                IconButton(
                    onClick = { showImportDialog = true },
                    modifier = Modifier
                        .minimumInteractiveComponentSize()
                        .testTag("import_playlist_button")
                ) {
                    Icon(
                        imageVector = SonoraIcons.CloudDownload,
                        contentDescription = "Импорт плейлиста YouTube",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Button(
                    onClick = { showCreatePlaylistDialog = true },
                    shape = CircleShape,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary
                    ),
                    modifier = Modifier
                        .height(36.dp)
                        .testTag("create_playlist_button")
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Add,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Создать", maxLines = 1, fontWeight = FontWeight.Bold)
                }
            }
        }

        AnimatedVisibility(visible = showFilterBar) {
            OutlinedTextField(
                value = filterQuery,
                onValueChange = { filterQuery = it },
                placeholder = {
                    Text(
                        text = "Поиск в медиатеке...",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Rounded.Search,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp)
                    )
                },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                trailingIcon = {
                    if (filterQuery.isNotEmpty()) {
                        IconButton(onClick = { filterQuery = "" }) {
                            Icon(Icons.Rounded.Close, contentDescription = "Очистить фильтр")
                        }
                    }
                },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                    focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.7f),
                    unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .testTag("library_filter_input")
            )
        }

        Spacer(modifier = Modifier.height(4.dp))

        LibraryAccountSyncBanner(
            uiState = accountUiState,
            onOpenLogin = onOpenYouTubeLogin,
            onSyncNow = { accountViewModel.syncAndMergeActiveAccount(onShowMessage) }
        )

        Spacer(modifier = Modifier.height(12.dp))

        val tabs = listOf(
            "Плейлисты",
            "Избранное (${uiState.favorites.size})",
            "Офлайн (${uiState.downloads.size})",
            "История"
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            itemsIndexed(tabs) { index, title ->
                SonoraFilterPill(
                    label = title,
                    selected = selectedTab == index,
                    onClick = { selectedTab = index },
                    modifier = Modifier.testTag("library_tab_$index")
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        when (selectedTab) {
            0 -> PlaylistsTabContent(
                playlists = filteredPlaylists,
                favoritesCount = uiState.favorites.size,
                downloadsCount = uiState.downloads.size,
                historyCount = uiState.history.size,
                youtubePlaylists = syncedYouTubePlaylists,
                isFiltering = normalizedFilter.isNotEmpty(),
                bottomContentPadding = bottomContentPadding,
                onSelectTab = { selectedTab = it },
                onOpenYouTubeCollection = {
                    if (syncedYouTubePlaylists.size == 1) {
                        onOpenPlaylist(syncedYouTubePlaylists.first().id)
                    } else if (syncedYouTubePlaylists.size > 1) {
                        showYouTubeCollectionSheet = true
                    }
                },
                onOpenPlaylist = onOpenPlaylist,
                onDeletePlaylist = { playlistPendingDelete = it }
            )

            1 -> TrackCollectionTabContent(
                tracks = filteredFavorites,
                favoriteIds = uiState.favoriteIds,
                downloadedIds = uiState.downloadedIds,
                downloadingIds = uiState.downloadingIds,
                currentTrackId = uiState.playbackState.currentTrack?.id,
                emptyIcon = Icons.Rounded.Favorite,
                emptyTitle = if (normalizedFilter.isNotEmpty()) "Ничего не найдено" else "Пока нет избранных треков",
                emptySubtitle = if (normalizedFilter.isNotEmpty()) {
                    "Попробуйте изменить поисковый запрос."
                } else {
                    "Нажмите на сердечко у любого трека, чтобы сохранить его здесь."
                },
                bottomContentPadding = bottomContentPadding,
                onPlayAll = { shuffle -> viewModel.playAll(filteredFavorites, shuffle) },
                onPlayTrack = { track -> viewModel.playTrack(track, filteredFavorites) },
                onPlayNext = { track ->
                    viewModel.playNext(track)
                    onShowMessage("«${track.title}» включится далее")
                },
                onStartRadio = { track -> viewModel.startTrackRadio(track, onShowMessage) },
                onToggleFavorite = viewModel::toggleFavorite,
                onToggleDownload = { track -> viewModel.toggleDownload(track, onShowMessage) },
                onAddToPlaylist = { trackForPlaylistDialog = it }
            )

            2 -> TrackCollectionTabContent(
                tracks = filteredDownloads,
                favoriteIds = uiState.favoriteIds,
                downloadedIds = uiState.downloadedIds,
                downloadingIds = uiState.downloadingIds,
                currentTrackId = uiState.playbackState.currentTrack?.id,
                emptyIcon = SonoraIcons.DownloadDone,
                emptyTitle = if (normalizedFilter.isNotEmpty()) "Ничего не найдено" else "Нет скачанных треков",
                emptySubtitle = if (normalizedFilter.isNotEmpty()) {
                    "Попробуйте изменить поисковый запрос."
                } else {
                    "Скачивайте треки через меню, чтобы слушать музыку без интернета."
                },
                bottomContentPadding = bottomContentPadding,
                onPlayAll = { shuffle -> viewModel.playAll(filteredDownloads, shuffle) },
                onPlayTrack = { track -> viewModel.playTrack(track, filteredDownloads) },
                onPlayNext = { track ->
                    viewModel.playNext(track)
                    onShowMessage("«${track.title}» включится далее")
                },
                onStartRadio = { track -> viewModel.startTrackRadio(track, onShowMessage) },
                onToggleFavorite = viewModel::toggleFavorite,
                onToggleDownload = { track -> viewModel.toggleDownload(track, onShowMessage) },
                onAddToPlaylist = { trackForPlaylistDialog = it }
            )

            else -> TrackCollectionTabContent(
                tracks = filteredHistory,
                favoriteIds = uiState.favoriteIds,
                downloadedIds = uiState.downloadedIds,
                downloadingIds = uiState.downloadingIds,
                currentTrackId = uiState.playbackState.currentTrack?.id,
                emptyIcon = SonoraIcons.History,
                emptyTitle = if (normalizedFilter.isNotEmpty()) "Ничего не найдено" else "История прослушивания пуста",
                emptySubtitle = if (normalizedFilter.isNotEmpty()) {
                    "Попробуйте изменить поисковый запрос."
                } else {
                    "Прослушанные треки появятся здесь автоматически."
                },
                bottomContentPadding = bottomContentPadding,
                onPlayAll = { shuffle -> viewModel.playAll(filteredHistory, shuffle) },
                onClearHistory = if (uiState.history.isNotEmpty()) {
                    { showClearHistoryConfirm = true }
                } else {
                    null
                },
                onPlayTrack = { track -> viewModel.playTrack(track, filteredHistory) },
                onPlayNext = { track ->
                    viewModel.playNext(track)
                    onShowMessage("«${track.title}» включится далее")
                },
                onStartRadio = { track -> viewModel.startTrackRadio(track, onShowMessage) },
                onToggleFavorite = viewModel::toggleFavorite,
                onToggleDownload = { track -> viewModel.toggleDownload(track, onShowMessage) },
                onAddToPlaylist = { trackForPlaylistDialog = it }
            )
        }
    }
}

private fun filterTracks(tracks: List<Track>, query: String): List<Track> {
    if (query.isEmpty()) return tracks
    return tracks.filter {
        it.title.contains(query, ignoreCase = true) ||
            it.artist.contains(query, ignoreCase = true)
    }
}

private sealed interface LibraryGridEntry {
    val key: String

    data class SmartCollection(
        override val key: String,
        val badge: String,
        val title: String,
        val subtitle: String,
        val countText: String,
        val icon: androidx.compose.ui.graphics.vector.ImageVector,
        val gradientColors: List<Color>,
        val onClickAction: () -> Unit
    ) : LibraryGridEntry

    data class UserPlaylist(val playlist: Playlist) : LibraryGridEntry {
        override val key: String = "playlist_${playlist.id}"
    }
}

@Composable
private fun PlaylistsTabContent(
    playlists: List<Playlist>,
    favoritesCount: Int,
    downloadsCount: Int,
    historyCount: Int,
    youtubePlaylists: List<Playlist>,
    isFiltering: Boolean,
    bottomContentPadding: PaddingValues,
    onSelectTab: (Int) -> Unit,
    onOpenYouTubeCollection: () -> Unit,
    onOpenPlaylist: (Long) -> Unit,
    onDeletePlaylist: (Playlist) -> Unit
) {
    val youtubeTotalTracks = remember(youtubePlaylists) {
        youtubePlaylists.sumOf { it.trackCount }
    }
    val smartCards = remember(favoritesCount, downloadsCount, historyCount, youtubePlaylists.size, youtubeTotalTracks, isFiltering) {
        if (isFiltering) {
            emptyList()
        } else {
            buildList {
                if (favoritesCount > 0) {
                    add(
                        LibraryGridEntry.SmartCollection(
                            key = "smart_favorites",
                            badge = "ИЗБРАННОЕ",
                            title = "Избранное",
                            subtitle = "Любимые композиции",
                            countText = "$favoritesCount треков",
                            icon = Icons.Rounded.Favorite,
                            gradientColors = listOf(Color(0xFF281938), Color(0xFF0E2B2A)),
                            onClickAction = { onSelectTab(1) }
                        )
                    )
                }
                if (downloadsCount > 0) {
                    add(
                        LibraryGridEntry.SmartCollection(
                            key = "smart_offline",
                            badge = "ОФЛАЙН",
                            title = "Офлайн-микс",
                            subtitle = "Сохранено в памяти",
                            countText = "$downloadsCount треков",
                            icon = SonoraIcons.DownloadDone,
                            gradientColors = listOf(Color(0xFF0F2D22), Color(0xFF14181D)),
                            onClickAction = { onSelectTab(2) }
                        )
                    )
                }
                if (historyCount > 0) {
                    add(
                        LibraryGridEntry.SmartCollection(
                            key = "smart_history",
                            badge = "ИСТОРИЯ",
                            title = "История эфира",
                            subtitle = "Недавние прослушивания",
                            countText = "$historyCount треков",
                            icon = SonoraIcons.History,
                            gradientColors = listOf(Color(0xFF2D2214), Color(0xFF14181D)),
                            onClickAction = { onSelectTab(3) }
                        )
                    )
                }
                if (youtubePlaylists.isNotEmpty() && youtubeTotalTracks > 0) {
                    add(
                        LibraryGridEntry.SmartCollection(
                            key = "smart_youtube",
                            badge = "YOUTUBE",
                            title = "YouTube Music",
                            subtitle = "Импорт из аккаунта",
                            countText = "$youtubeTotalTracks треков",
                            icon = SonoraIcons.CloudDownload,
                            gradientColors = listOf(Color(0xFF0E2B38), Color(0xFF14181D)),
                            onClickAction = onOpenYouTubeCollection
                        )
                    )
                }
            }
        }
    }

    val allEntries = remember(smartCards, playlists) {
        smartCards + playlists.map { LibraryGridEntry.UserPlaylist(it) }
    }

    if (allEntries.isEmpty()) {
        EmptyLibraryPlaceholder(
            icon = SonoraIcons.LibraryMusic,
            title = if (isFiltering) "Плейлисты не найдены" else stringResource(R.string.empty_library_title),
            subtitle = if (isFiltering) "Попробуйте другой поисковый запрос." else stringResource(R.string.empty_library_subtitle)
        )
    } else {
        val rows = remember(allEntries) { allEntries.chunked(2) }
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = 8.dp,
                bottom = bottomContentPadding.calculateBottomPadding() + 18.dp
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(rows, key = { row -> row.joinToString("_") { it.key } }) { pair ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    pair.forEach { entry ->
                        when (entry) {
                            is LibraryGridEntry.SmartCollection -> {
                                SmartCollectionGridCard(
                                    entry = entry,
                                    onClick = entry.onClickAction,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                            is LibraryGridEntry.UserPlaylist -> {
                                PlaylistGridCard(
                                    playlist = entry.playlist,
                                    onClick = { onOpenPlaylist(entry.playlist.id) },
                                    onDeleteClick = { onDeletePlaylist(entry.playlist) },
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                    }
                    if (pair.size == 1) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun SmartCollectionGridCard(
    entry: LibraryGridEntry.SmartCollection,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier
            .clip(RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .testTag(entry.key),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.65f))
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(106.dp)
                    .background(Brush.linearGradient(colors = entry.gradientColors))
            ) {
                Icon(
                    imageVector = entry.icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .size(34.dp)
                        .align(Alignment.Center)
                )
                SonoraPillBadge(
                    text = entry.badge,
                    contentColor = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                )
            }
            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                Text(
                    text = entry.title,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = entry.subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = entry.countText,
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1
                )
            }
        }
    }
}

@Composable
private fun PlaylistGridCard(
    playlist: Playlist,
    onClick: () -> Unit,
    onDeleteClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val isYouTube = !playlist.youtubePlaylistId.isNullOrBlank()
    Surface(
        modifier = modifier
            .clip(RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .testTag("playlist_card_${playlist.id}"),
        shape = RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.65f))
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(106.dp)
                    .background(
                        Brush.linearGradient(
                            colors = if (isYouTube) {
                                listOf(Color(0xFF0E2B2A), Color(0xFF14181D))
                            } else {
                                listOf(Color(0xFF1D2430), Color(0xFF14181D))
                            }
                        )
                    )
            ) {
                if (!playlist.coverUrl.isNullOrBlank()) {
                    AsyncImage(
                        model = playlist.coverUrl,
                        contentDescription = "${playlist.name} обложка",
                        placeholder = painterResource(R.drawable.img_default_cover),
                        error = painterResource(R.drawable.img_default_cover),
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Icon(
                        imageVector = SonoraIcons.QueueMusic,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.85f),
                        modifier = Modifier
                            .size(34.dp)
                            .align(Alignment.Center)
                    )
                }

                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                colors = listOf(
                                    Color(0x22090B0E),
                                    Color(0xB3090B0E)
                                )
                            )
                        )
                )

                SonoraPillBadge(
                    text = if (isYouTube) "YOUTUBE" else "ПЛЕЙЛИСТ",
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                )

                IconButton(
                    onClick = onDeleteClick,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .minimumInteractiveComponentSize()
                        .testTag("delete_playlist_${playlist.id}")
                ) {
                    Surface(
                        shape = CircleShape,
                        color = Color(0x99090B0E),
                        modifier = Modifier.size(28.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = SonoraIcons.DeleteOutline,
                                contentDescription = "Удалить плейлист",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                }
            }

            Column(
                modifier = Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                Text(
                    text = playlist.name,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = playlist.description.ifBlank { "Локальная коллекция" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = "${playlist.trackCount} треков",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = MaterialTheme.colorScheme.primary,
                    maxLines = 1
                )
            }
        }
    }
}

@Composable
private fun TrackCollectionTabContent(
    tracks: List<Track>,
    favoriteIds: Set<String>,
    downloadedIds: Set<String>,
    downloadingIds: Set<String>,
    currentTrackId: String?,
    emptyIcon: androidx.compose.ui.graphics.vector.ImageVector,
    emptyTitle: String,
    emptySubtitle: String,
    bottomContentPadding: PaddingValues,
    onPlayAll: (Boolean) -> Unit,
    onClearHistory: (() -> Unit)? = null,
    onPlayTrack: (Track) -> Unit,
    onPlayNext: (Track) -> Unit,
    onStartRadio: (Track) -> Unit,
    onToggleFavorite: (Track) -> Unit,
    onToggleDownload: (Track) -> Unit,
    onAddToPlaylist: (Track) -> Unit
) {
    if (tracks.isEmpty()) {
        EmptyLibraryPlaceholder(
            icon = emptyIcon,
            title = emptyTitle,
            subtitle = emptySubtitle
        )
    } else {
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = 8.dp,
                bottom = bottomContentPadding.calculateBottomPadding() + 18.dp
            ),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            item(key = "collection_actions_bar") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = { onPlayAll(false) },
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary
                            ),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
                        ) {
                            Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Слушать", fontWeight = FontWeight.Bold)
                        }
                        OutlinedButton(
                            onClick = { onPlayAll(true) },
                            shape = CircleShape,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp)
                        ) {
                            Icon(SonoraIcons.Shuffle, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Микс")
                        }
                    }

                    if (onClearHistory != null) {
                        TextButton(onClick = onClearHistory) {
                            Text("Очистить")
                        }
                    }
                }
            }

            items(tracks, key = { it.id }) { track ->
                TrackRowItem(
                    track = track,
                    isCurrentTrack = currentTrackId == track.id,
                    isFavorite = track.id in favoriteIds,
                    isDownloaded = track.id in downloadedIds,
                    isDownloading = track.id in downloadingIds,
                    onPlayClick = { onPlayTrack(track) },
                    onFavoriteClick = { onToggleFavorite(track) },
                    onPlayNextClick = { onPlayNext(track) },
                    onStartRadioClick = { onStartRadio(track) },
                    onDownloadClick = { onToggleDownload(track) },
                    onAddToPlaylistClick = { onAddToPlaylist(track) }
                )
            }
        }
    }
}

@Composable
private fun EmptyLibraryPlaceholder(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.75f),
                modifier = Modifier.size(52.dp)
            )
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                textAlign = TextAlign.Center
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }
    }
}
