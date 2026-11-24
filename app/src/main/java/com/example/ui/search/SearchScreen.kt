package com.example.ui.search

import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.example.R
import com.example.domain.model.SearchFilter
import com.example.domain.model.Track
import com.example.ui.components.AddToPlaylistDialog
import com.example.ui.components.SonoraCard
import com.example.ui.components.SonoraFilterPill
import com.example.ui.components.SonoraIcons
import com.example.ui.components.SonoraPillBadge
import com.example.ui.components.TrackRowItem
import java.util.Locale

private data class GenreDiscoveryCard(
    val query: String,
    val title: String,
    val subtitle: String,
    val badge: String,
    val badgeContainerColor: Color,
    val badgeContentColor: Color,
    val gradientStart: Color,
    val gradientEnd: Color
)

private val QUICK_GENRE_DISCOVERY_CARDS = listOf(
    GenreDiscoveryCard(
        query = "Lo-Fi радио",
        title = "Lo-Fi радио",
        subtitle = "Бесконечный поток кассетного уюта",
        badge = "ХИТ",
        badgeContainerColor = Color(0xB8090B0E),
        badgeContentColor = Color(0xFFF5F7FA),
        gradientStart = Color(0xFF422212),
        gradientEnd = Color(0xFF14181D)
    ),
    GenreDiscoveryCard(
        query = "Акустический инди",
        title = "Акустический инди",
        subtitle = "Живые гитары и камерный вокал",
        badge = "НОВИНКА",
        badgeContainerColor = Color(0xB8090B0E),
        badgeContentColor = Color(0xFF00E676),
        gradientStart = Color(0xFF0E3438),
        gradientEnd = Color(0xFF14181D)
    ),
    GenreDiscoveryCard(
        query = "Джаз пиано",
        title = "Джаз пиано",
        subtitle = "Ночной джаз-клуб в центре города",
        badge = "VIBE",
        badgeContainerColor = Color(0xB8090B0E),
        badgeContentColor = Color(0xFFF5F7FA),
        gradientStart = Color(0xFF2D193E),
        gradientEnd = Color(0xFF14181D)
    ),
    GenreDiscoveryCard(
        query = "Synthwave",
        title = "Synthwave",
        subtitle = "Ночной неон и глубокий бас",
        badge = "LIVE",
        badgeContainerColor = Color(0xFFE11D48),
        badgeContentColor = Color(0xFFFFFFFF),
        gradientStart = Color(0xFF103A2C),
        gradientEnd = Color(0xFF14181D)
    ),
    GenreDiscoveryCard(
        query = "Hans Zimmer soundtrack",
        title = "Hans Zimmer",
        subtitle = "Эпические саундтреки и оркестр",
        badge = "КИНО",
        badgeContainerColor = Color(0xB8090B0E),
        badgeContentColor = Color(0xFFF5F7FA),
        gradientStart = Color(0xFF3A2A10),
        gradientEnd = Color(0xFF14181D)
    ),
    GenreDiscoveryCard(
        query = "Daft Punk",
        title = "Daft Punk",
        subtitle = "Электронная классика и грув",
        badge = "ЭЛЕКТРО",
        badgeContainerColor = Color(0xB8090B0E),
        badgeContentColor = Color(0xFF00E676),
        gradientStart = Color(0xFF142A42),
        gradientEnd = Color(0xFF14181D)
    )
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SearchScreen(
    bottomContentPadding: PaddingValues,
    onShowMessage: (String) -> Unit,
    pendingQuery: String? = null,
    onConsumePendingQuery: () -> Unit = {},
    viewModel: SearchViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val keyboardController = LocalSoftwareKeyboardController.current
    var trackForPlaylistDialog by remember { mutableStateOf<Track?>(null) }

    LaunchedEffect(pendingQuery) {
        val q = pendingQuery?.trim()
        if (!q.isNullOrBlank()) {
            viewModel.submitSearch(q)
            onConsumePendingQuery()
        }
    }

    BackHandler(enabled = uiState.canNavigateBackInResults) {
        viewModel.navigateBackInResults()
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

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .imePadding()
            .padding(horizontal = 16.dp)
    ) {
        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = "Поиск",
            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onBackground
        )

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedTextField(
            value = uiState.query,
            onValueChange = viewModel::onQueryChange,
            placeholder = {
                Text(
                    text = stringResource(R.string.search_hint),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            },
            leadingIcon = {
                Icon(
                    imageVector = Icons.Rounded.Search,
                    contentDescription = "Иконка поиска",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            trailingIcon = {
                if (uiState.query.isNotEmpty()) {
                    IconButton(
                        onClick = { viewModel.onQueryChange("") },
                        modifier = Modifier.testTag("clear_search_button")
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Close,
                            contentDescription = "Очистить поиск"
                        )
                    }
                }
            },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.7f),
                unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)
            ),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(
                onSearch = {
                    keyboardController?.hide()
                    viewModel.submitSearch()
                }
            ),
            modifier = Modifier
                .fillMaxWidth()
                .testTag("search_input")
        )

        Spacer(modifier = Modifier.height(10.dp))

        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            items(SearchFilter.entries) { filter ->
                SonoraFilterPill(
                    label = filter.label,
                    selected = uiState.selectedFilter == filter,
                    onClick = { viewModel.selectFilter(filter) },
                    modifier = Modifier.testTag("search_filter_${filter.name}")
                )
            }
        }

        if (uiState.canNavigateBackInResults) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(
                    onClick = { viewModel.navigateBackInResults() },
                    modifier = Modifier.testTag("search_back_to_results_button")
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("К результатам поиска")
                }
            }
        }

        if (uiState.suggestions.isNotEmpty() && uiState.resultsState is SearchResultsState.Idle) {
            SonoraCard(
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp)
            ) {
                uiState.suggestions.forEachIndexed { idx, suggestion ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                keyboardController?.hide()
                                viewModel.submitSearch(suggestion)
                            }
                            .padding(start = 14.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Search,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(12.dp))
                        Text(
                            text = suggestion,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.weight(1f),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        IconButton(
                            onClick = { viewModel.fillQueryFromSuggestion(suggestion) },
                            modifier = Modifier.minimumInteractiveComponentSize()
                        ) {
                            Icon(
                                imageVector = SonoraIcons.NorthWest,
                                contentDescription = "Дополнить запрос $suggestion",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                    if (idx < uiState.suggestions.lastIndex) {
                        HorizontalDivider(
                            thickness = 0.5.dp,
                            color = MaterialTheme.colorScheme.outline.copy(alpha = 0.45f),
                            modifier = Modifier.padding(horizontal = 14.dp)
                        )
                    }
                }
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        when (val results = uiState.resultsState) {
            is SearchResultsState.Idle -> {
                val genreRows = remember { QUICK_GENRE_DISCOVERY_CARDS.chunked(2) }
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(
                        bottom = bottomContentPadding.calculateBottomPadding() + 18.dp
                    ),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    item(key = "quick_genres_header") {
                        Text(
                            text = "Подборки и жанры",
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = MaterialTheme.colorScheme.onBackground
                        )
                    }

                    items(
                        items = genreRows,
                        key = { row -> row.joinToString("_") { it.query } }
                    ) { pair ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            pair.forEach { card ->
                                Surface(
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(132.dp)
                                        .clip(RoundedCornerShape(18.dp))
                                        .clickable {
                                            keyboardController?.hide()
                                            viewModel.submitSearch(card.query)
                                        },
                                    shape = RoundedCornerShape(18.dp),
                                    color = MaterialTheme.colorScheme.surfaceContainerLow,
                                    border = BorderStroke(
                                        1.dp,
                                        MaterialTheme.colorScheme.outline.copy(alpha = 0.65f)
                                    )
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .fillMaxSize()
                                            .background(
                                                Brush.verticalGradient(
                                                    colors = listOf(card.gradientStart, card.gradientEnd)
                                                )
                                            )
                                            .padding(12.dp)
                                    ) {
                                        SonoraPillBadge(
                                            text = card.badge,
                                            containerColor = card.badgeContainerColor,
                                            contentColor = card.badgeContentColor,
                                            modifier = Modifier.align(Alignment.TopStart)
                                        )
                                        Column(
                                            modifier = Modifier.align(Alignment.BottomStart),
                                            verticalArrangement = Arrangement.spacedBy(2.dp)
                                        ) {
                                            Text(
                                                text = card.title,
                                                style = MaterialTheme.typography.titleSmall.copy(
                                                    fontWeight = FontWeight.Bold
                                                ),
                                                color = MaterialTheme.colorScheme.onBackground,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            Text(
                                                text = card.subtitle,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                maxLines = 2,
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

                    if (uiState.localMatches.isNotEmpty()) {
                        item(key = "local_matches_header", contentType = "section_header") {
                            Text(
                                text = "В вашей медиатеке",
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.padding(top = 6.dp)
                            )
                        }
                        items(
                            items = uiState.localMatches,
                            key = { "local_${it.id}" },
                            contentType = { "track_row" }
                        ) { track ->
                            TrackRowItem(
                                track = track,
                                isCurrentTrack = uiState.playbackState.currentTrack?.id == track.id,
                                isFavorite = track.id in uiState.favoriteIds,
                                isDownloaded = track.id in uiState.downloadedIds,
                                isDownloading = track.id in uiState.downloadingIds,
                                onPlayClick = {
                                    keyboardController?.hide()
                                    viewModel.playTrack(track, uiState.localMatches)
                                },
                                onFavoriteClick = { viewModel.toggleFavorite(track) },
                                onPlayNextClick = {
                                    viewModel.playNext(track)
                                    onShowMessage("«${track.title}» включится далее")
                                },
                                onStartRadioClick = { viewModel.startTrackRadio(track, onShowMessage) },
                                onDownloadClick = { viewModel.toggleDownload(track, onShowMessage) },
                                onAddToPlaylistClick = { trackForPlaylistDialog = track }
                            )
                        }
                    }

                    if (uiState.searchHistory.isNotEmpty()) {
                        item(key = "recent_searches_card", contentType = "search_history") {
                            SonoraCard(modifier = Modifier.fillMaxWidth()) {
                                Column(
                                    modifier = Modifier.padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text(
                                            text = "Недавние запросы",
                                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                            color = MaterialTheme.colorScheme.onSurface
                                        )
                                        TextButton(onClick = viewModel::clearSearchHistory) {
                                            Text("Очистить")
                                        }
                                    }
                                    uiState.searchHistory.forEach { pastQuery ->
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .clip(RoundedCornerShape(10.dp))
                                                .clickable {
                                                    keyboardController?.hide()
                                                    viewModel.submitSearch(pastQuery)
                                                }
                                                .padding(horizontal = 6.dp, vertical = 4.dp),
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Icon(
                                                imageVector = SonoraIcons.History,
                                                contentDescription = null,
                                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                                modifier = Modifier.size(18.dp)
                                            )
                                            Spacer(modifier = Modifier.width(10.dp))
                                            Text(
                                                text = pastQuery,
                                                style = MaterialTheme.typography.bodyMedium,
                                                color = MaterialTheme.colorScheme.onSurface,
                                                modifier = Modifier.weight(1f),
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            IconButton(
                                                onClick = { viewModel.deleteSearchQuery(pastQuery) },
                                                modifier = Modifier.minimumInteractiveComponentSize()
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Rounded.Close,
                                                    contentDescription = "Удалить запрос",
                                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                                    modifier = Modifier.size(16.dp)
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    if (uiState.searchHistory.isEmpty() && uiState.localMatches.isEmpty()) {
                        item(key = "empty_search_hint", contentType = "empty_hint") {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 20.dp, horizontal = 12.dp)
                            ) {
                                Icon(
                                    imageVector = SonoraIcons.MusicNote,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.75f),
                                    modifier = Modifier.size(40.dp)
                                )
                                Text(
                                    text = stringResource(R.string.empty_search_title),
                                    style = MaterialTheme.typography.titleMedium,
                                    textAlign = TextAlign.Center
                                )
                                Text(
                                    text = stringResource(R.string.empty_search_subtitle),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    textAlign = TextAlign.Center
                                )
                            }
                        }
                    }
                }
            }

            is SearchResultsState.Loading -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                }
            }

            is SearchResultsState.Error -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.padding(24.dp)
                        ) {
                            Text(
                                text = results.message,
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.error,
                                textAlign = TextAlign.Center
                            )
                            Button(
                                onClick = { viewModel.submitSearch() },
                                shape = CircleShape
                            ) {
                                Text("Повторить")
                            }
                        }
                    }
                }
            }

            is SearchResultsState.Playlists -> {
                if (results.items.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "Плейлисты не найдены.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    val context = LocalContext.current
                    LazyColumn(
                        contentPadding = PaddingValues(
                            bottom = bottomContentPadding.calculateBottomPadding() + 18.dp
                        ),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(
                            items = results.items,
                            key = { it.url },
                            contentType = { "playlist_row" }
                        ) { playlist ->
                            val imageRequest = remember(playlist.thumbnailUrl) {
                                ImageRequest.Builder(context)
                                    .data(playlist.thumbnailUrl)
                                    .size(168)
                                    .crossfade(true)
                                    .build()
                            }
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .clickable { viewModel.openPlaylistSummary(playlist) },
                                shape = RoundedCornerShape(14.dp),
                                color = MaterialTheme.colorScheme.surfaceContainerLow,
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.55f))
                            ) {
                                Row(
                                    modifier = Modifier.padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    AsyncImage(
                                        model = imageRequest,
                                        contentDescription = playlist.name,
                                        placeholder = painterResource(R.drawable.img_default_cover),
                                        error = painterResource(R.drawable.img_default_cover),
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier
                                            .size(54.dp)
                                            .clip(RoundedCornerShape(10.dp))
                                    )
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = playlist.name,
                                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            text = "${playlist.uploaderName} • ${playlist.trackCount} треков",
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
                }
            }

            is SearchResultsState.Artists -> {
                if (results.items.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "Исполнители не найдены.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    val context = LocalContext.current
                    LazyColumn(
                        contentPadding = PaddingValues(
                            bottom = bottomContentPadding.calculateBottomPadding() + 18.dp
                        ),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(
                            items = results.items,
                            key = { it.url },
                            contentType = { "artist_row" }
                        ) { artist ->
                            val imageRequest = remember(artist.thumbnailUrl) {
                                ImageRequest.Builder(context)
                                    .data(artist.thumbnailUrl)
                                    .size(168)
                                    .crossfade(true)
                                    .build()
                            }
                            Surface(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .clickable { viewModel.openArtistSummary(artist) },
                                shape = RoundedCornerShape(14.dp),
                                color = MaterialTheme.colorScheme.surfaceContainerLow,
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.55f))
                            ) {
                                Row(
                                    modifier = Modifier.padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    AsyncImage(
                                        model = imageRequest,
                                        contentDescription = artist.name,
                                        placeholder = painterResource(R.drawable.img_default_cover),
                                        error = painterResource(R.drawable.img_default_cover),
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier
                                            .size(54.dp)
                                            .clip(CircleShape)
                                    )
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = artist.name,
                                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        if (artist.subscriberCount > 0) {
                                            Text(
                                                text = "${formatCompactCount(artist.subscriberCount)} подписчиков",
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            is SearchResultsState.Tracks -> {
                if (results.items.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "Подходящие треки не найдены.",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(
                            bottom = bottomContentPadding.calculateBottomPadding() + 18.dp
                        ),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        results.playlistTitle?.let { playlistTitle ->
                            item(key = "playlist_header", contentType = "playlist_header") {
                                SonoraCard(
                                    borderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.4f),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(bottom = 6.dp)
                                ) {
                                    Column(
                                        modifier = Modifier.padding(16.dp),
                                        verticalArrangement = Arrangement.spacedBy(10.dp)
                                    ) {
                                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                            Text(
                                                text = playlistTitle,
                                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                                maxLines = 2,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                            Text(
                                                text = "${results.items.size} треков",
                                                style = MaterialTheme.typography.labelMedium,
                                                color = MaterialTheme.colorScheme.primary
                                            )
                                        }
                                        FlowRow(
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            verticalArrangement = Arrangement.spacedBy(8.dp)
                                        ) {
                                            OutlinedButton(
                                                onClick = {
                                                    viewModel.saveLoadedPlaylistToLibrary(
                                                        playlistTitle,
                                                        results.items,
                                                        onShowMessage
                                                    )
                                                },
                                                shape = CircleShape,
                                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
                                            ) {
                                                Icon(
                                                    SonoraIcons.BookmarkAdd,
                                                    contentDescription = null,
                                                    modifier = Modifier.size(18.dp)
                                                )
                                                Spacer(modifier = Modifier.width(6.dp))
                                                Text("Сохранить")
                                            }
                                            Button(
                                                onClick = {
                                                    viewModel.playAll(results.items, shuffle = false)
                                                },
                                                shape = CircleShape,
                                                colors = ButtonDefaults.buttonColors(
                                                    containerColor = MaterialTheme.colorScheme.primary,
                                                    contentColor = MaterialTheme.colorScheme.onPrimary
                                                )
                                            ) {
                                                Icon(
                                                    Icons.Rounded.PlayArrow,
                                                    contentDescription = null,
                                                    modifier = Modifier.size(18.dp)
                                                )
                                                Spacer(modifier = Modifier.width(4.dp))
                                                Text("Играть", fontWeight = FontWeight.Bold)
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if (results.playlistTitle == null) {
                            item(key = "tracks_actions_header", contentType = "actions_header") {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(bottom = 4.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "Найдено: ${results.items.size}",
                                        style = MaterialTheme.typography.labelLarge,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Button(
                                            onClick = { viewModel.playAll(results.items, shuffle = false) },
                                            shape = CircleShape,
                                            contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                                            colors = ButtonDefaults.buttonColors(
                                                containerColor = MaterialTheme.colorScheme.primary,
                                                contentColor = MaterialTheme.colorScheme.onPrimary
                                            ),
                                            modifier = Modifier.testTag("search_play_all_button")
                                        ) {
                                            Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                                            Spacer(modifier = Modifier.width(4.dp))
                                            Text("Всё", fontWeight = FontWeight.Bold)
                                        }
                                        OutlinedButton(
                                            onClick = { viewModel.playAll(results.items, shuffle = true) },
                                            shape = CircleShape,
                                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                            modifier = Modifier.testTag("search_shuffle_button")
                                        ) {
                                            Icon(SonoraIcons.Shuffle, contentDescription = null, modifier = Modifier.size(18.dp))
                                            Spacer(modifier = Modifier.width(4.dp))
                                            Text("Микс")
                                        }
                                    }
                                }
                            }
                        }

                        items(
                            items = results.items,
                            key = { it.id },
                            contentType = { "track_row" }
                        ) { track ->
                            TrackRowItem(
                                track = track,
                                isCurrentTrack = uiState.playbackState.currentTrack?.id == track.id,
                                isFavorite = track.id in uiState.favoriteIds,
                                isDownloaded = track.id in uiState.downloadedIds,
                                isDownloading = track.id in uiState.downloadingIds,
                                onPlayClick = {
                                    keyboardController?.hide()
                                    viewModel.playTrack(track, results.items)
                                },
                                onFavoriteClick = { viewModel.toggleFavorite(track) },
                                onPlayNextClick = {
                                    viewModel.playNext(track)
                                    onShowMessage("«${track.title}» включится далее")
                                },
                                onStartRadioClick = { viewModel.startTrackRadio(track, onShowMessage) },
                                onDownloadClick = { viewModel.toggleDownload(track, onShowMessage) },
                                onAddToPlaylistClick = { trackForPlaylistDialog = track }
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun formatCompactCount(count: Long): String {
    return when {
        count >= 1_000_000L -> String.format(Locale.US, "%.1f млн", count / 1_000_000f)
        count >= 1_000L -> String.format(Locale.US, "%.0f тыс.", count / 1_000f)
        else -> count.toString()
    }
}
