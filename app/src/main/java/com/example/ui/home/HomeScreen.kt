package com.example.ui.home

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.example.R
import com.example.core.common.DurationFormatter
import com.example.domain.model.Playlist
import com.example.domain.model.Track
import com.example.domain.model.YouTubeAccount
import com.example.ui.components.AddToPlaylistDialog
import com.example.ui.components.SonoraCard
import com.example.ui.components.SonoraFilterPill
import com.example.ui.components.SonoraIcons
import com.example.ui.components.SonoraPillBadge
import com.example.ui.components.TrackRowItem
import java.util.Calendar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onNavigateToSearch: () -> Unit,
    onOpenPlaylist: (Long) -> Unit,
    onOpenSettings: () -> Unit,
    bottomContentPadding: PaddingValues,
    onShowMessage: (String) -> Unit,
    onOpenFavorites: () -> Unit = {},
    onOpenNowPlaying: () -> Unit = {},
    onOpenLibraryPlaylists: () -> Unit = {},
    onOpenHistory: () -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var trackForPlaylistDialog by remember { mutableStateOf<Track?>(null) }
    var trackForActionsSheet by remember { mutableStateOf<Pair<Track, List<Track>>?>(null) }

    val currentHour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    val greeting = remember(currentHour) {
        when (currentHour) {
            in 5..11 -> "Доброе утро"
            in 12..17 -> "Добрый день"
            in 18..22 -> "Добрый вечер"
            else -> "Ночной эфир"
        }
    }

    trackForPlaylistDialog?.let { selectedTrack ->
        AddToPlaylistDialog(
            track = selectedTrack,
            playlists = uiState.playlists,
            onDismiss = { trackForPlaylistDialog = null },
            onSelectPlaylist = { playlistId ->
                viewModel.addTrackToPlaylist(playlistId, selectedTrack)
                onShowMessage("Трек добавлен в плейлист")
                trackForPlaylistDialog = null
            },
            onCreateNewPlaylistAndAdd = { name ->
                viewModel.createPlaylistAndAddTrack(name, selectedTrack)
                onShowMessage("Плейлист «$name» создан")
                trackForPlaylistDialog = null
            }
        )
    }

    trackForActionsSheet?.let { (selectedTrack, contextQueue) ->
        HomeTrackActionsSheet(
            track = selectedTrack,
            isFavorite = selectedTrack.id in uiState.favoriteIds,
            isDownloaded = selectedTrack.id in uiState.downloadedIds,
            onDismiss = { trackForActionsSheet = null },
            onPlayNow = {
                viewModel.playTrack(selectedTrack, contextQueue)
                trackForActionsSheet = null
            },
            onPlayNext = {
                viewModel.playNext(selectedTrack)
                onShowMessage("«${selectedTrack.title}» включится далее")
                trackForActionsSheet = null
            },
            onStartRadio = {
                trackForActionsSheet = null
                viewModel.startTrackRadio(selectedTrack, onShowMessage)
            },
            onToggleFavorite = {
                viewModel.toggleFavorite(selectedTrack)
                trackForActionsSheet = null
            },
            onAddToPlaylist = {
                trackForActionsSheet = null
                trackForPlaylistDialog = selectedTrack
            },
            onToggleDownload = {
                trackForActionsSheet = null
                viewModel.toggleDownload(selectedTrack, onShowMessage)
            }
        )
    }

    val pullRefreshState = rememberPullToRefreshState()

    PullToRefreshBox(
        isRefreshing = uiState.isRefreshing,
        onRefresh = viewModel::refreshAll,
        state = pullRefreshState,
        indicator = {
            PullToRefreshDefaults.Indicator(
                state = pullRefreshState,
                isRefreshing = uiState.isRefreshing,
                containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.align(Alignment.TopCenter)
            )
        },
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .testTag("home_pull_refresh")
    ) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                top = 12.dp,
                bottom = bottomContentPadding.calculateBottomPadding() + 18.dp
            ),
            verticalArrangement = Arrangement.spacedBy(22.dp)
        ) {
            item(key = "home_top_header") {
                HomeTopHeader(
                    greeting = greeting,
                    account = uiState.activeAccount,
                    onSearchClick = onNavigateToSearch,
                    onAccountClick = onOpenSettings
                )
            }

            item(key = "home_hero_banner") {
                HeroBannerCard(
                    currentTrack = uiState.playbackState.currentTrack,
                    isPlaying = uiState.playbackState.isPlaying,
                    lastHistoryTrack = uiState.history.firstOrNull(),
                    dailyMixTracks = uiState.dailyMixTracks,
                    dailyMixSubtitle = uiState.dailyMixSubtitle,
                    isOnline = uiState.isOnline,
                    onCardClick = {
                        if (uiState.playbackState.currentTrack != null) {
                            onOpenNowPlaying()
                        } else {
                            viewModel.playDailyMix(
                                shuffle = false,
                                onEmpty = {
                                    onShowMessage("Подключитесь к сети или найдите трек")
                                    onNavigateToSearch()
                                }
                            )
                        }
                    },
                    onPrimaryActionClick = {
                        viewModel.handleHeroPrimaryClick(
                            onEmpty = {
                                onShowMessage("Нет треков для запуска — откройте Поиск")
                                onNavigateToSearch()
                            }
                        )
                    },
                    onSecondaryActionClick = {
                        when {
                            uiState.playbackState.currentTrack != null -> onOpenNowPlaying()
                            uiState.history.isNotEmpty() -> viewModel.resumeLastTrack(onEmpty = onNavigateToSearch)
                            uiState.dailyMixTracks.isNotEmpty() -> viewModel.playDailyMix(shuffle = true)
                            else -> onNavigateToSearch()
                        }
                    }
                )
            }

            if (uiState.quickPicks.isNotEmpty()) {
                item(key = "home_quick_picks") {
                    QuickPicksSection(
                        tracks = uiState.quickPicks,
                        currentTrackId = uiState.playbackState.currentTrack?.id,
                        downloadedIds = uiState.downloadedIds,
                        onTrackClick = viewModel::playQuickPick,
                        onTrackLongClick = { track ->
                            trackForActionsSheet = track to uiState.quickPicks
                        }
                    )
                }
            }

            if (uiState.history.isNotEmpty()) {
                item(key = "home_recent_history") {
                    val recentTracks = remember(uiState.history) { uiState.history.take(10) }
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        HomeSectionHeader(
                            title = "Недавно прослушано",
                            actionLabel = "Все",
                            actionTestTag = "home_history_see_all",
                            onActionClick = onOpenHistory
                        )
                        LazyRow(
                            contentPadding = PaddingValues(horizontal = 16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            items(
                                items = recentTracks,
                                key = { "hist_${it.id}" },
                                contentType = { "recent_card" }
                            ) { track ->
                                RecentTrackCard(
                                    track = track,
                                    isPlaying = uiState.playbackState.currentTrack?.id == track.id,
                                    isDownloaded = track.id in uiState.downloadedIds,
                                    onClick = { viewModel.playTrack(track, uiState.history) },
                                    onLongClick = {
                                        trackForActionsSheet = track to uiState.history
                                    }
                                )
                            }
                        }
                    }
                }
            }

            if (uiState.playlists.isNotEmpty() || uiState.downloadedTracks.isNotEmpty() || uiState.favorites.isNotEmpty()) {
                item(key = "home_playlists") {
                    HomePlaylistsSection(
                        playlists = uiState.playlists,
                        favoritesCount = uiState.favorites.size,
                        offlineCount = uiState.downloadedTracks.size,
                        onOpenFavorites = onOpenFavorites,
                        onOpenPlaylist = onOpenPlaylist,
                        onOpenAllPlaylists = onOpenLibraryPlaylists,
                        onPlayOfflineMix = {
                            viewModel.playOfflineMix(onUnavailable = onShowMessage)
                            if (uiState.downloadedTracks.isNotEmpty()) {
                                onShowMessage("Запущен офлайн-микс")
                            }
                        }
                    )
                }
            }

            item(key = "home_mood_header") {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Рекомендации вайба",
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        color = MaterialTheme.colorScheme.onBackground,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(horizontal = 16.dp)
                    )

                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(
                            items = uiState.moods,
                            key = { it },
                            contentType = { "mood_chip" }
                        ) { mood ->
                            SonoraFilterPill(
                                label = mood,
                                selected = mood == uiState.selectedMood,
                                onClick = { viewModel.selectMood(mood) },
                                modifier = Modifier.testTag("mood_chip_$mood")
                            )
                        }
                    }

                    val discoverSuccess = uiState.discoverState as? DiscoverUiState.Success
                    val discoverTracks = discoverSuccess?.tracks
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        if (!discoverTracks.isNullOrEmpty()) {
                            Button(
                                onClick = {
                                    viewModel.playMix(shuffle = false, onUnavailable = onShowMessage)
                                },
                                shape = CircleShape,
                                contentPadding = PaddingValues(horizontal = 18.dp, vertical = 10.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.primary,
                                    contentColor = MaterialTheme.colorScheme.onPrimary
                                ),
                                modifier = Modifier.testTag("discover_play_all_button")
                            ) {
                                Icon(
                                    imageVector = Icons.Rounded.PlayArrow,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "Играть всё",
                                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold)
                                )
                            }
                        } else {
                            Spacer(modifier = Modifier.width(1.dp))
                        }

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            if (!discoverTracks.isNullOrEmpty()) {
                                IconButton(
                                    onClick = {
                                        viewModel.playMix(shuffle = true, onUnavailable = onShowMessage)
                                    },
                                    modifier = Modifier
                                        .minimumInteractiveComponentSize()
                                        .testTag("discover_shuffle_button")
                                ) {
                                    Surface(
                                        shape = CircleShape,
                                        color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                        border = BorderStroke(
                                            1.dp,
                                            MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)
                                        ),
                                        modifier = Modifier.size(38.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Icon(
                                                imageVector = SonoraIcons.Shuffle,
                                                contentDescription = "Перемешать подборку",
                                                tint = MaterialTheme.colorScheme.onSurface,
                                                modifier = Modifier.size(18.dp)
                                            )
                                        }
                                    }
                                }
                            }

                            IconButton(
                                onClick = viewModel::retryDiscover,
                                modifier = Modifier
                                    .minimumInteractiveComponentSize()
                                    .testTag("discover_refresh_button")
                            ) {
                                Surface(
                                    shape = CircleShape,
                                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                    border = BorderStroke(
                                        1.dp,
                                        MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)
                                    ),
                                    modifier = Modifier.size(38.dp)
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(
                                            imageVector = Icons.Rounded.Refresh,
                                            contentDescription = "Обновить подборку",
                                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                            modifier = Modifier.size(18.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    if (discoverSuccess?.isOfflineFallback == true && !discoverSuccess.subtitle.isNullOrBlank()) {
                        Surface(
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                            border = BorderStroke(
                                1.dp,
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.35f)
                            ),
                            modifier = Modifier.padding(horizontal = 16.dp)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Icon(
                                    imageVector = SonoraIcons.DownloadDone,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(14.dp)
                                )
                                Text(
                                    text = discoverSuccess.subtitle,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                }
            }

            when (val discover = uiState.discoverState) {
                is DiscoverUiState.Loading -> {
                    item(key = "discover_loading_skeleton") {
                        DiscoverLoadingSkeleton(
                            moodLabel = uiState.selectedMood
                        )
                    }
                }

                is DiscoverUiState.Empty -> {
                    item(key = "discover_empty_card") {
                        SonoraCard(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp)
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(20.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Text(
                                    text = "По подборке «${discover.mood}» треки не найдены",
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Button(
                                        onClick = viewModel::retryDiscover,
                                        shape = CircleShape,
                                        modifier = Modifier.testTag("empty_retry_discover_button")
                                    ) {
                                        Icon(Icons.Rounded.Refresh, contentDescription = null)
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text("Обновить")
                                    }
                                    if (discover.mood != HomeUiState.MOOD_FOR_YOU) {
                                        OutlinedButton(
                                            onClick = { viewModel.selectMood(HomeUiState.MOOD_FOR_YOU) },
                                            shape = CircleShape
                                        ) {
                                            Text(HomeUiState.MOOD_FOR_YOU)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                is DiscoverUiState.Error -> {
                    item(key = "discover_error_card") {
                        SonoraCard(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp)
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(20.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Text(
                                    text = if (!uiState.isOnline) {
                                        "Нет подключения к интернету"
                                    } else {
                                        discover.message
                                    },
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    Button(
                                        onClick = viewModel::retryDiscover,
                                        shape = CircleShape,
                                        modifier = Modifier.testTag("retry_discover_button")
                                    ) {
                                        Icon(Icons.Rounded.Refresh, contentDescription = null)
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text("Повторить")
                                    }
                                    if (uiState.downloadedTracks.isNotEmpty()) {
                                        OutlinedButton(
                                            onClick = { viewModel.playOfflineMix(onUnavailable = onShowMessage) },
                                            shape = CircleShape
                                        ) {
                                            Icon(SonoraIcons.DownloadDone, contentDescription = null)
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text("Офлайн (${uiState.downloadedTracks.size})")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                is DiscoverUiState.Success -> {
                    items(
                        items = discover.tracks,
                        key = { "disc_${it.id}" },
                        contentType = { "track_row" }
                    ) { track ->
                        TrackRowItem(
                            track = track,
                            isCurrentTrack = uiState.playbackState.currentTrack?.id == track.id,
                            isFavorite = track.id in uiState.favoriteIds,
                            isDownloaded = track.id in uiState.downloadedIds,
                            isDownloading = track.id in uiState.downloadingIds,
                            onPlayClick = { viewModel.playTrack(track, discover.tracks) },
                            onFavoriteClick = { viewModel.toggleFavorite(track) },
                            onPlayNextClick = {
                                viewModel.playNext(track)
                                onShowMessage("«${track.title}» включится далее")
                            },
                            onStartRadioClick = { viewModel.startTrackRadio(track, onShowMessage) },
                            onDownloadClick = { viewModel.toggleDownload(track, onShowMessage) },
                            onAddToPlaylistClick = { trackForPlaylistDialog = track },
                            modifier = Modifier.padding(horizontal = 16.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeSectionHeader(
    title: String,
    actionLabel: String,
    actionTestTag: String,
    onActionClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onBackground,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        TextButton(
            onClick = onActionClick,
            modifier = Modifier
                .minimumInteractiveComponentSize()
                .testTag(actionTestTag)
        ) {
            Text(
                text = actionLabel,
                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun HomeTopHeader(
    greeting: String,
    account: YouTubeAccount?,
    onSearchClick: () -> Unit,
    onAccountClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = greeting,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = account?.name?.takeIf { it.isNotBlank() } ?: "Sonora",
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(
                onClick = onSearchClick,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .testTag("home_header_search_button")
            ) {
                Surface(
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)),
                    modifier = Modifier.size(40.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Rounded.Search,
                            contentDescription = "Поиск музыки",
                            tint = MaterialTheme.colorScheme.onSurface,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }

            Box(
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onAccountClick)
                    .testTag("home_account_avatar"),
                contentAlignment = Alignment.Center
            ) {
                Surface(
                    modifier = Modifier
                        .size(42.dp)
                        .border(
                            width = 1.5.dp,
                            color = MaterialTheme.colorScheme.primary,
                            shape = CircleShape
                        ),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceContainerHigh
                ) {
                    if (account?.avatarUrl?.isNotBlank() == true) {
                        AsyncImage(
                            model = account.avatarUrl,
                            contentDescription = "Профиль ${account.name}",
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize()
                        )
                    } else {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = SonoraIcons.AccountCircle,
                                contentDescription = "Настройки и аккаунт",
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(24.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HeroBannerCard(
    currentTrack: Track?,
    isPlaying: Boolean,
    lastHistoryTrack: Track?,
    dailyMixTracks: List<Track>,
    dailyMixSubtitle: String,
    isOnline: Boolean,
    onCardClick: () -> Unit,
    onPrimaryActionClick: () -> Unit,
    onSecondaryActionClick: () -> Unit
) {
    val coverTrack = currentTrack ?: dailyMixTracks.firstOrNull() ?: lastHistoryTrack
    val badgeText = when {
        currentTrack != null && isPlaying -> "СЕЙЧАС В ЭФИРЕ"
        currentTrack != null -> "НА ПАУЗЕ"
        !isOnline && dailyMixTracks.isNotEmpty() -> "ОФЛАЙН-МИКС"
        else -> "МИКС ДНЯ • ДЛЯ ВАС"
    }
    val titleText = currentTrack?.title ?: "Микс дня"
    val subtitleText = when {
        currentTrack != null -> "${currentTrack.artist} • Нажмите, чтобы открыть плеер"
        else -> dailyMixSubtitle
    }
    val primaryLabel = when {
        currentTrack != null && isPlaying -> "Пауза"
        currentTrack != null -> "Продолжить"
        else -> "Слушать"
    }
    val secondaryIcon: ImageVector
    val secondaryLabel: String
    when {
        currentTrack != null -> {
            secondaryIcon = SonoraIcons.GraphicEq
            secondaryLabel = "В плеер"
        }
        lastHistoryTrack != null -> {
            secondaryIcon = SonoraIcons.History
            secondaryLabel = "Последний"
        }
        dailyMixTracks.isNotEmpty() -> {
            secondaryIcon = SonoraIcons.Shuffle
            secondaryLabel = "Перемешать"
        }
        else -> {
            secondaryIcon = Icons.Rounded.Search
            secondaryLabel = "Поиск"
        }
    }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .height(228.dp)
            .clip(RoundedCornerShape(22.dp))
            .clickable(onClick = onCardClick)
            .testTag("hero_banner_card"),
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.7f))
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            val heroArtUrl = coverTrack?.thumbnailUrl?.takeIf { it.isNotBlank() }
            if (heroArtUrl != null) {
                AsyncImage(
                    model = heroArtUrl,
                    contentDescription = "Баннер Sonora",
                    placeholder = painterResource(R.drawable.img_hero_discover),
                    error = painterResource(R.drawable.img_hero_discover),
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Image(
                    painter = painterResource(R.drawable.img_hero_discover),
                    contentDescription = "Баннер Sonora",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            }

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color(0x66090B0E),
                                Color(0x9E090B0E),
                                Color(0xF2090B0E)
                            )
                        )
                    )
            )

            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(20.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    SonoraPillBadge(
                        text = badgeText,
                        containerColor = Color(0xB8090B0E),
                        contentColor = MaterialTheme.colorScheme.primary
                    )

                    if (currentTrack == null && dailyMixTracks.isNotEmpty()) {
                        SonoraPillBadge(
                            text = DurationFormatter.formatTrackCount(dailyMixTracks.size),
                            containerColor = Color(0xB8090B0E),
                            contentColor = Color(0xFFF5F7FA)
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = titleText,
                            style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.ExtraBold),
                            color = Color(0xFFF5F7FA),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = subtitleText,
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color(0xFFD1D7E0),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(
                            onClick = onPrimaryActionClick,
                            shape = CircleShape,
                            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary
                            ),
                            modifier = Modifier.testTag("hero_play_button")
                        ) {
                            Icon(
                                imageVector = if (currentTrack != null && isPlaying) {
                                    SonoraIcons.Pause
                                } else {
                                    Icons.Rounded.PlayArrow
                                },
                                contentDescription = null,
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(primaryLabel, fontWeight = FontWeight.Bold)
                        }

                        Button(
                            onClick = onSecondaryActionClick,
                            shape = CircleShape,
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Color(0xD614181D),
                                contentColor = Color(0xFFF5F7FA)
                            ),
                            border = BorderStroke(1.dp, Color(0x66FFFFFF)),
                            modifier = Modifier.testTag("hero_secondary_button")
                        ) {
                            Icon(
                                imageVector = secondaryIcon,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(secondaryLabel, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun QuickPicksSection(
    tracks: List<Track>,
    currentTrackId: String?,
    downloadedIds: Set<String>,
    onTrackClick: (Track) -> Unit,
    onTrackLongClick: (Track) -> Unit
) {
    val haptics = LocalHapticFeedback.current
    val rows = remember(tracks) { tracks.chunked(2) }
    Column(
        modifier = Modifier.padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text(
            text = "Быстрый выбор",
            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onBackground
        )
        rows.forEach { pair ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                pair.forEach { track ->
                    val isCurrent = track.id == currentTrackId
                    val isDownloaded = track.id in downloadedIds
                    Surface(
                        modifier = Modifier
                            .weight(1f)
                            .height(58.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .combinedClickable(
                                onClick = { onTrackClick(track) },
                                onLongClick = {
                                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    onTrackLongClick(track)
                                }
                            )
                            .testTag("quick_pick_${track.id}"),
                        color = if (isCurrent) {
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.45f)
                        } else {
                            MaterialTheme.colorScheme.surfaceContainerLow
                        },
                        border = BorderStroke(
                            width = 1.dp,
                            color = if (isCurrent) {
                                MaterialTheme.colorScheme.primary.copy(alpha = 0.55f)
                            } else {
                                MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)
                            }
                        ),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(58.dp)
                                    .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                                contentAlignment = Alignment.Center
                            ) {
                                AsyncImage(
                                    model = track.thumbnailUrl,
                                    contentDescription = track.title,
                                    placeholder = painterResource(R.drawable.img_default_cover),
                                    error = painterResource(R.drawable.img_default_cover),
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize()
                                )
                                if (isCurrent) {
                                    Box(
                                        modifier = Modifier
                                            .fillMaxSize()
                                            .background(Color(0x99090B0E)),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Icon(
                                            imageVector = SonoraIcons.GraphicEq,
                                            contentDescription = "Сейчас играет",
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(20.dp)
                                        )
                                    }
                                }
                            }
                            Column(
                                modifier = Modifier
                                    .weight(1f)
                                    .padding(horizontal = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Text(
                                    text = track.title,
                                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                                    color = if (isCurrent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    if (isDownloaded) {
                                        Icon(
                                            imageVector = SonoraIcons.DownloadDone,
                                            contentDescription = "Скачано",
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(12.dp)
                                        )
                                    }
                                    Text(
                                        text = track.artist,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
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

@Composable
private fun HomePlaylistsSection(
    playlists: List<Playlist>,
    favoritesCount: Int,
    offlineCount: Int,
    onOpenFavorites: () -> Unit,
    onOpenPlaylist: (Long) -> Unit,
    onOpenAllPlaylists: () -> Unit,
    onPlayOfflineMix: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        HomeSectionHeader(
            title = "Ваши плейлисты",
            actionLabel = "Все",
            actionTestTag = "home_playlists_see_all",
            onActionClick = onOpenAllPlaylists
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (favoritesCount > 0) {
                item(key = "favorites_smart_card") {
                    Surface(
                        modifier = Modifier
                            .width(184.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .clickable(onClick = onOpenFavorites)
                            .testTag("home_favorites_card"),
                        color = MaterialTheme.colorScheme.surfaceContainerLow,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Column {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(104.dp)
                                    .background(
                                        Brush.linearGradient(
                                            colors = listOf(
                                                Color(0xFF281938),
                                                Color(0xFF0E2B2A)
                                            )
                                        )
                                    )
                                    .padding(10.dp)
                            ) {
                                SonoraPillBadge(
                                    text = "ИЗБРАННОЕ",
                                    containerColor = Color(0xB8090B0E),
                                    contentColor = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.align(Alignment.TopStart)
                                )
                                Icon(
                                    imageVector = Icons.Rounded.Favorite,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier
                                        .size(34.dp)
                                        .align(Alignment.Center)
                                )
                            }
                            Column(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Text(
                                    text = "Любимые треки",
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = DurationFormatter.formatTrackCount(favoritesCount),
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                }
            }

            if (offlineCount > 0) {
                item(key = "offline_mix_card") {
                    Surface(
                        modifier = Modifier
                            .width(184.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .clickable(onClick = onPlayOfflineMix)
                            .testTag("home_offline_mix_card"),
                        color = MaterialTheme.colorScheme.surfaceContainerLow,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.45f)),
                        shape = RoundedCornerShape(16.dp)
                    ) {
                        Column {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(104.dp)
                                    .background(
                                        Brush.linearGradient(
                                            colors = listOf(
                                                MaterialTheme.colorScheme.primaryContainer,
                                                MaterialTheme.colorScheme.surfaceContainerHigh
                                            )
                                        )
                                    )
                                    .padding(10.dp)
                            ) {
                                SonoraPillBadge(
                                    text = "ОФЛАЙН",
                                    containerColor = Color(0xB8090B0E),
                                    contentColor = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.align(Alignment.TopStart)
                                )
                                Icon(
                                    imageVector = SonoraIcons.DownloadDone,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier
                                        .size(34.dp)
                                        .align(Alignment.Center)
                                )
                            }
                            Column(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(2.dp)
                            ) {
                                Text(
                                    text = "Офлайн-микс",
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = "${DurationFormatter.formatTrackCount(offlineCount)} • Слушать",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }
                    }
                }
            }

            items(
                items = playlists,
                key = { "pl_${it.id}" },
                contentType = { "playlist_card" }
            ) { playlist ->
                val isYouTube = !playlist.youtubePlaylistId.isNullOrBlank()
                Surface(
                    modifier = Modifier
                        .width(184.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .clickable { onOpenPlaylist(playlist.id) }
                        .testTag("home_playlist_${playlist.id}"),
                    color = MaterialTheme.colorScheme.surfaceContainerLow,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(104.dp)
                                .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                        ) {
                            AsyncImage(
                                model = playlist.coverUrl,
                                contentDescription = playlist.name,
                                placeholder = painterResource(R.drawable.img_default_cover),
                                error = painterResource(R.drawable.img_default_cover),
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.fillMaxSize()
                            )
                            Box(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .background(
                                        Brush.verticalGradient(
                                            colors = listOf(
                                                Color.Transparent,
                                                Color(0x99090B0E)
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
                        }
                        Column(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                            verticalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Text(
                                text = playlist.name,
                                style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = DurationFormatter.formatTrackCount(playlist.trackCount),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RecentTrackCard(
    track: Track,
    isPlaying: Boolean,
    isDownloaded: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit
) {
    val haptics = LocalHapticFeedback.current
    Surface(
        modifier = Modifier
            .width(172.dp)
            .clip(RoundedCornerShape(16.dp))
            .combinedClickable(
                onClick = onClick,
                onLongClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    onLongClick()
                }
            )
            .testTag("recent_card_${track.id}"),
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(
            width = 1.dp,
            color = if (isPlaying) {
                MaterialTheme.colorScheme.primary.copy(alpha = 0.65f)
            } else {
                MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)
            }
        )
    ) {
        Column {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(100.dp)
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            ) {
                AsyncImage(
                    model = track.thumbnailUrl,
                    contentDescription = "${track.title} обложка",
                    placeholder = painterResource(R.drawable.img_default_cover),
                    error = painterResource(R.drawable.img_default_cover),
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                colors = listOf(
                                    Color.Transparent,
                                    Color(0xA6090B0E)
                                )
                            )
                        )
                )
                SonoraPillBadge(
                    text = if (isPlaying) "ИГРАЕТ" else if (isDownloaded) "ОФЛАЙН" else "ТРЕК",
                    contentColor = if (isPlaying || isDownloaded) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        Color(0xFFF5F7FA)
                    },
                    modifier = Modifier
                        .align(Alignment.TopStart)
                        .padding(8.dp)
                )
                if (isPlaying) {
                    Icon(
                        imageVector = SonoraIcons.GraphicEq,
                        contentDescription = "Сейчас играет",
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(8.dp)
                            .size(22.dp)
                    )
                }
            }
            Column(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    text = track.title,
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                    color = if (isPlaying) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text(
                    text = track.artist,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

@Composable
private fun DiscoverLoadingSkeleton(moodLabel: String) {
    val transition = rememberInfiniteTransition(label = "discover_skeleton")
    val pulseAlpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.75f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 850),
            repeatMode = RepeatMode.Reverse
        ),
        label = "skeleton_alpha"
    )

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Text(
            text = "Подбираем волну «$moodLabel»...",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        repeat(4) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.35f))
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(50.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = pulseAlpha))
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.65f)
                                .height(14.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = pulseAlpha))
                        )
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(0.42f)
                                .height(11.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = pulseAlpha * 0.8f))
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeTrackActionsSheet(
    track: Track,
    isFavorite: Boolean,
    isDownloaded: Boolean,
    onDismiss: () -> Unit,
    onPlayNow: () -> Unit,
    onPlayNext: () -> Unit,
    onStartRadio: () -> Unit,
    onToggleFavorite: () -> Unit,
    onAddToPlaylist: () -> Unit,
    onToggleDownload: () -> Unit
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                AsyncImage(
                    model = track.thumbnailUrl,
                    contentDescription = track.title,
                    placeholder = painterResource(R.drawable.img_default_cover),
                    error = painterResource(R.drawable.img_default_cover),
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .size(52.dp)
                        .clip(RoundedCornerShape(10.dp))
                )
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = track.title,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = track.artist,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }

            HorizontalDivider(
                thickness = 0.5.dp,
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.5f),
                modifier = Modifier.padding(bottom = 6.dp)
            )

            HomeSheetActionRow(
                icon = Icons.Rounded.PlayArrow,
                label = "Слушать сейчас",
                tint = MaterialTheme.colorScheme.primary,
                onClick = onPlayNow
            )
            HomeSheetActionRow(
                icon = SonoraIcons.QueueMusic,
                label = "Включить далее",
                onClick = onPlayNext
            )
            HomeSheetActionRow(
                icon = SonoraIcons.Radio,
                label = "Запустить радио по треку",
                onClick = onStartRadio
            )
            HomeSheetActionRow(
                icon = if (isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                label = if (isFavorite) "Убрать из избранного" else "Добавить в избранное",
                tint = if (isFavorite) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                onClick = onToggleFavorite
            )
            HomeSheetActionRow(
                icon = SonoraIcons.PlaylistAdd,
                label = "Добавить в плейлист",
                onClick = onAddToPlaylist
            )
            HomeSheetActionRow(
                icon = if (isDownloaded) SonoraIcons.DownloadDone else SonoraIcons.DownloadForOffline,
                label = if (isDownloaded) "Удалить офлайн-копию" else "Скачать офлайн",
                onClick = onToggleDownload
            )
        }
    }
}

@Composable
private fun HomeSheetActionRow(
    icon: ImageVector,
    label: String,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .minimumInteractiveComponentSize()
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(22.dp)
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}
