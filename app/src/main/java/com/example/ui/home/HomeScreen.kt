package com.example.ui.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.example.R
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

@Composable
fun HomeScreen(
    onNavigateToSearch: () -> Unit,
    onOpenPlaylist: (Long) -> Unit,
    onOpenSettings: () -> Unit,
    bottomContentPadding: PaddingValues,
    onShowMessage: (String) -> Unit,
    onOpenFavorites: () -> Unit = {},
    viewModel: HomeViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var trackForPlaylistDialog by remember { mutableStateOf<Track?>(null) }

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

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(
            top = 12.dp,
            bottom = bottomContentPadding.calculateBottomPadding() + 18.dp
        ),
        verticalArrangement = Arrangement.spacedBy(22.dp)
    ) {
        item {
            HomeTopHeader(
                greeting = greeting,
                account = uiState.activeAccount,
                onSearchClick = onNavigateToSearch,
                onAccountClick = onOpenSettings
            )
        }

        item {
            HeroBannerCard(
                currentTrack = uiState.playbackState.currentTrack,
                isPlaying = uiState.playbackState.isPlaying,
                lastHistoryTrack = uiState.history.firstOrNull(),
                hasDiscoverTracks = (uiState.discoverState as? DiscoverUiState.Success)?.tracks?.isNotEmpty() == true,
                onSearchClick = onNavigateToSearch,
                onPrimaryActionClick = {
                    viewModel.resumeLastOrMix(onEmpty = onNavigateToSearch)
                },
                onShuffleMixClick = { viewModel.playMix(shuffle = true) }
            )
        }

        if (uiState.quickPicks.isNotEmpty()) {
            item {
                QuickPicksSection(
                    tracks = uiState.quickPicks,
                    currentTrackId = uiState.playbackState.currentTrack?.id,
                    onTrackClick = { track ->
                        viewModel.playTrack(track, uiState.quickPicks)
                    }
                )
            }
        }

        if (uiState.history.isNotEmpty()) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Недавно прослушано",
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                        color = MaterialTheme.colorScheme.onBackground,
                        modifier = Modifier.padding(horizontal = 16.dp)
                    )
                    val recentTracks = remember(uiState.history) { uiState.history.take(10) }
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
                                onClick = { viewModel.playTrack(track, uiState.history) }
                            )
                        }
                    }
                }
            }
        }

        if (uiState.playlists.isNotEmpty() || uiState.downloadedTracks.isNotEmpty() || uiState.favorites.isNotEmpty()) {
            item {
                HomePlaylistsSection(
                    playlists = uiState.playlists,
                    favoritesCount = uiState.favorites.size,
                    offlineCount = uiState.downloadedTracks.size,
                    onOpenFavorites = onOpenFavorites,
                    onOpenPlaylist = onOpenPlaylist,
                    onPlayOfflineMix = {
                        viewModel.playOfflineMix()
                        onShowMessage("Запущен офлайн-микс")
                    }
                )
            }
        }

        item {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "Подборка по настроению",
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

                val discoverTracks = (uiState.discoverState as? DiscoverUiState.Success)?.tracks
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    if (!discoverTracks.isNullOrEmpty()) {
                        Button(
                            onClick = { viewModel.playMix(shuffle = false) },
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
                                onClick = { viewModel.playMix(shuffle = true) },
                                modifier = Modifier
                                    .size(48.dp)
                                    .testTag("discover_shuffle_button")
                            ) {
                                Surface(
                                    shape = CircleShape,
                                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)),
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
                                .size(48.dp)
                                .testTag("discover_refresh_button")
                        ) {
                            Surface(
                                shape = CircleShape,
                                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)),
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
            }
        }

        when (val discover = uiState.discoverState) {
            is DiscoverUiState.Loading -> {
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 36.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                            Text(
                                text = "Настраиваем волну «${uiState.selectedMood}»...",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            is DiscoverUiState.Error -> {
                item {
                    SonoraCard(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp)
                    ) {
                        Column(
                            modifier = Modifier.padding(20.dp),
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
                                        onClick = viewModel::playOfflineMix,
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
                    .size(48.dp)
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
    hasDiscoverTracks: Boolean,
    onSearchClick: () -> Unit,
    onPrimaryActionClick: () -> Unit,
    onShuffleMixClick: () -> Unit
) {
    val spotlightTrack = currentTrack ?: lastHistoryTrack
    val subtitle = when {
        currentTrack != null -> "Сейчас в эфире: ${currentTrack.title} • ${currentTrack.artist}"
        lastHistoryTrack != null -> "Продолжить: ${lastHistoryTrack.title} • ${lastHistoryTrack.artist}"
        else -> "Бесконечный поток музыки и офлайн-плейлисты"
    }
    val primaryLabel = when {
        currentTrack != null && isPlaying -> "Пауза"
        spotlightTrack != null -> "Слушать"
        else -> "Микс дня"
    }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .height(228.dp),
        shape = RoundedCornerShape(22.dp),
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.7f))
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            val heroArtUrl = spotlightTrack?.thumbnailUrl?.takeIf { it.isNotBlank() }
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
                                Color(0x523B230E),
                                Color(0x8C18110B),
                                Color(0xF0090B0E)
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
                SonoraPillBadge(
                    text = if (currentTrack != null) "СЕЙЧАС ИГРАЕТ" else "МИКС ДНЯ",
                    containerColor = Color(0xAA090B0E),
                    contentColor = MaterialTheme.colorScheme.primary
                )

                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            text = spotlightTrack?.title ?: "Микс дня",
                            style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.ExtraBold),
                            color = MaterialTheme.colorScheme.onBackground,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = subtitle,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.78f),
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

                        if (hasDiscoverTracks) {
                            Button(
                                onClick = onShuffleMixClick,
                                shape = CircleShape,
                                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.88f),
                                    contentColor = MaterialTheme.colorScheme.onSurface
                                ),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.75f)),
                                modifier = Modifier.testTag("hero_shuffle_button")
                            ) {
                                Icon(
                                    imageVector = SonoraIcons.Shuffle,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Микс")
                            }
                        } else {
                            Button(
                                onClick = onSearchClick,
                                shape = CircleShape,
                                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.88f),
                                    contentColor = MaterialTheme.colorScheme.onSurface
                                ),
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.75f)),
                                modifier = Modifier.testTag("hero_search_button")
                            ) {
                                Icon(Icons.Rounded.Search, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Поиск")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun QuickPicksSection(
    tracks: List<Track>,
    currentTrackId: String?,
    onTrackClick: (Track) -> Unit
) {
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
                    Surface(
                        modifier = Modifier
                            .weight(1f)
                            .height(58.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .clickable { onTrackClick(track) }
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
                            AsyncImage(
                                model = track.thumbnailUrl,
                                contentDescription = track.title,
                                placeholder = painterResource(R.drawable.img_default_cover),
                                error = painterResource(R.drawable.img_default_cover),
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .size(58.dp)
                                    .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                            )
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
    onPlayOfflineMix: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            text = "Ваши плейлисты",
            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(horizontal = 16.dp)
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
                                    text = "$favoritesCount треков",
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
                                    text = "$offlineCount скачано",
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
                                text = "${playlist.trackCount} треков",
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

@Composable
private fun RecentTrackCard(
    track: Track,
    isPlaying: Boolean,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier
            .width(172.dp)
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
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
                    text = if (isPlaying) "ИГРАЕТ" else "ТРЕК",
                    contentColor = if (isPlaying) MaterialTheme.colorScheme.primary else Color(0xFFF5F7FA),
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
