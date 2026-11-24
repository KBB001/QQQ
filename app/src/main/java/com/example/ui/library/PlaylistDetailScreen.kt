package com.example.ui.library

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.example.R
import com.example.ui.components.EditPlaylistDialog
import com.example.ui.components.SonoraIcons
import com.example.ui.components.TrackRowItem

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PlaylistDetailScreen(
    onBack: () -> Unit,
    bottomContentPadding: PaddingValues,
    onShowMessage: (String) -> Unit,
    viewModel: PlaylistDetailViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val playlist = uiState.playlist
    val context = LocalContext.current
    var showEditDialog by remember { mutableStateOf(false) }
    var showFilterInput by rememberSaveable { mutableStateOf(false) }
    var filterQuery by rememberSaveable { mutableStateOf("") }

    if (showEditDialog && playlist != null) {
        EditPlaylistDialog(
            initialName = playlist.name,
            initialDescription = playlist.description,
            onDismiss = { showEditDialog = false },
            onSave = { newName, newDescription ->
                viewModel.updatePlaylistDetails(newName, newDescription)
                showEditDialog = false
                onShowMessage("Плейлист обновлён")
            }
        )
    }

    val filteredTracks = remember(uiState.tracks, filterQuery) {
        val q = filterQuery.trim()
        if (q.isEmpty()) uiState.tracks
        else uiState.tracks.filter {
            it.title.contains(q, ignoreCase = true) ||
                it.artist.contains(q, ignoreCase = true)
        }
    }

    val totalDurationSeconds = remember(uiState.tracks) {
        uiState.tracks.sumOf { it.durationSeconds.coerceAtLeast(0L) }
    }
    val hasMissingOffline = remember(uiState.tracks, uiState.downloadedIds) {
        uiState.tracks.any { it.id !in uiState.downloadedIds }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(340.dp)
                .background(
                    Brush.verticalGradient(
                        colors = listOf(
                            Color(0xFF281938).copy(alpha = 0.72f),
                            MaterialTheme.colorScheme.background
                        )
                    )
                )
        )

        Column(modifier = Modifier.fillMaxSize()) {
            TopAppBar(
                windowInsets = WindowInsets(0, 0, 0, 0),
                title = {
                    Text(
                        text = playlist?.name ?: "Плейлист",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
                    )
                },
                navigationIcon = {
                    IconButton(
                        onClick = onBack,
                        modifier = Modifier.testTag("playlist_back_button")
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                            contentDescription = "Назад"
                        )
                    }
                },
                actions = {
                    if (uiState.tracks.isNotEmpty()) {
                        IconButton(
                            onClick = {
                                showFilterInput = !showFilterInput
                                if (!showFilterInput) filterQuery = ""
                            },
                            modifier = Modifier.testTag("playlist_filter_button")
                        ) {
                            Icon(
                                imageVector = SonoraIcons.FilterList,
                                contentDescription = "Фильтр треков",
                                tint = if (showFilterInput || filterQuery.isNotEmpty()) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                }
                            )
                        }
                    }
                    if (playlist != null) {
                        IconButton(
                            onClick = { showEditDialog = true },
                            modifier = Modifier.testTag("playlist_edit_button")
                        ) {
                            Icon(
                                imageVector = SonoraIcons.Edit,
                                contentDescription = "Редактировать плейлист"
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Transparent
                )
            )

            AnimatedVisibility(visible = showFilterInput) {
                OutlinedTextField(
                    value = filterQuery,
                    onValueChange = { filterQuery = it },
                    placeholder = { Text("Поиск в плейлисте...") },
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
                        .padding(horizontal = 16.dp, vertical = 6.dp)
                        .testTag("playlist_filter_input")
                )
            }

            LazyColumn(
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    bottom = bottomContentPadding.calculateBottomPadding() + 18.dp
                ),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        AsyncImage(
                            model = playlist?.coverUrl,
                            contentDescription = "Обложка плейлиста",
                            placeholder = painterResource(R.drawable.img_default_cover),
                            error = painterResource(R.drawable.img_default_cover),
                            contentScale = ContentScale.Crop,
                            modifier = Modifier
                                .size(176.dp)
                                .clip(RoundedCornerShape(20.dp))
                                .border(
                                    width = 1.dp,
                                    color = MaterialTheme.colorScheme.outline.copy(alpha = 0.7f),
                                    shape = RoundedCornerShape(20.dp)
                                )
                                .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                        )

                        Text(
                            text = playlist?.name ?: "Плейлист",
                            style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
                            color = MaterialTheme.colorScheme.onBackground,
                            textAlign = TextAlign.Center
                        )
                        if (!playlist?.description.isNullOrBlank()) {
                            Text(
                                text = playlist.description,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = TextAlign.Center
                            )
                        }
                        Text(
                            text = formatPlaylistStats(uiState.tracks.size, totalDurationSeconds),
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.primary
                        )

                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 6.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Button(
                                    onClick = { viewModel.playAll(shuffle = false) },
                                    enabled = uiState.tracks.isNotEmpty(),
                                    shape = CircleShape,
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = MaterialTheme.colorScheme.primary,
                                        contentColor = MaterialTheme.colorScheme.onPrimary
                                    ),
                                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
                                    modifier = Modifier.testTag("playlist_play_all_button")
                                ) {
                                    Icon(Icons.Rounded.PlayArrow, contentDescription = null, modifier = Modifier.size(20.dp))
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text("Слушать", fontWeight = FontWeight.Bold)
                                }

                                IconButton(
                                    onClick = { viewModel.playAll(shuffle = true) },
                                    enabled = uiState.tracks.isNotEmpty(),
                                    modifier = Modifier
                                        .minimumInteractiveComponentSize()
                                        .testTag("playlist_shuffle_button")
                                ) {
                                    Icon(
                                        imageVector = SonoraIcons.Shuffle,
                                        contentDescription = "Перемешать",
                                        tint = MaterialTheme.colorScheme.onBackground
                                    )
                                }
                            }

                            Row(
                                horizontalArrangement = Arrangement.spacedBy(2.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                IconButton(
                                    onClick = { viewModel.addAllToQueue(onShowMessage) },
                                    enabled = uiState.tracks.isNotEmpty(),
                                    modifier = Modifier
                                        .minimumInteractiveComponentSize()
                                        .testTag("playlist_add_queue_button")
                                ) {
                                    Icon(
                                        imageVector = SonoraIcons.PlaylistPlay,
                                        contentDescription = "В очередь",
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }

                                if (playlist != null) {
                                    IconButton(
                                        onClick = {
                                            val shareText = buildString {
                                                append(playlist.name)
                                                if (playlist.description.isNotBlank()) {
                                                    append(" — ${playlist.description}")
                                                }
                                                if (!playlist.youtubePlaylistId.isNullOrBlank()) {
                                                    append("\nhttps://music.youtube.com/playlist?list=${Uri.encode(playlist.youtubePlaylistId)}")
                                                } else if (uiState.tracks.isNotEmpty()) {
                                                    append("\n\n")
                                                    uiState.tracks.take(10).forEachIndexed { idx, tr ->
                                                        append("${idx + 1}. ${tr.title} — ${tr.artist}\n")
                                                    }
                                                    if (uiState.tracks.size > 10) {
                                                        append("и ещё ${uiState.tracks.size - 10} треков")
                                                    }
                                                }
                                            }
                                            val intent = Intent(Intent.ACTION_SEND).apply {
                                                type = "text/plain"
                                                putExtra(Intent.EXTRA_TEXT, shareText)
                                            }
                                            runCatching {
                                                context.startActivity(Intent.createChooser(intent, "Поделиться плейлистом"))
                                            }
                                        },
                                        modifier = Modifier
                                            .minimumInteractiveComponentSize()
                                            .testTag("playlist_share_button")
                                    ) {
                                        Icon(
                                            imageVector = SonoraIcons.Share,
                                            contentDescription = "Поделиться плейлистом",
                                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }

                                if (hasMissingOffline && uiState.tracks.isNotEmpty()) {
                                    IconButton(
                                        onClick = { viewModel.downloadAllMissing(onShowMessage) },
                                        enabled = !uiState.isBatchDownloading,
                                        modifier = Modifier
                                            .minimumInteractiveComponentSize()
                                            .testTag("playlist_download_all_button")
                                    ) {
                                        if (uiState.isBatchDownloading) {
                                            CircularProgressIndicator(
                                                modifier = Modifier.size(20.dp),
                                                strokeWidth = 2.dp,
                                                color = MaterialTheme.colorScheme.primary
                                            )
                                        } else {
                                            Icon(
                                                imageVector = SonoraIcons.DownloadForOffline,
                                                contentDescription = "Скачать всё",
                                                tint = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                if (filteredTracks.isEmpty()) {
                    item {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 36.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = if (filterQuery.isNotBlank()) {
                                    "По запросу «$filterQuery» ничего не найдено."
                                } else {
                                    "В плейлисте пока нет треков. Добавляйте музыку с главной страницы или из поиска."
                                },
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                } else {
                    itemsIndexed(filteredTracks, key = { _, track -> track.id }) { index, track ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                text = "${index + 1}",
                                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                                color = if (uiState.playbackState.currentTrack?.id == track.id) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.primary.copy(alpha = 0.78f)
                                },
                                textAlign = TextAlign.Center,
                                modifier = Modifier.width(24.dp)
                            )
                            TrackRowItem(
                                track = track,
                                isCurrentTrack = uiState.playbackState.currentTrack?.id == track.id,
                                isFavorite = track.id in uiState.favoriteIds,
                                isDownloaded = track.id in uiState.downloadedIds,
                                isDownloading = track.id in uiState.downloadingIds,
                                onPlayClick = { viewModel.playTrack(track) },
                                onFavoriteClick = { viewModel.toggleFavorite(track) },
                                onPlayNextClick = {
                                    viewModel.playNext(track)
                                    onShowMessage("«${track.title}» включится далее")
                                },
                                onStartRadioClick = { viewModel.startTrackRadio(track, onShowMessage) },
                                onDownloadClick = { viewModel.toggleDownload(track, onShowMessage) },
                                onRemoveFromPlaylistClick = {
                                    viewModel.removeTrack(track.id)
                                    onShowMessage("Трек удалён из плейлиста")
                                },
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun formatPlaylistStats(trackCount: Int, totalSeconds: Long): String {
    if (totalSeconds <= 0L) return "$trackCount треков"
    val totalMinutes = totalSeconds / 60L
    val hours = totalMinutes / 60L
    val mins = totalMinutes % 60L
    val durationLabel = if (hours > 0L) "$hours ч $mins мин" else "$mins мин"
    return "$trackCount треков • $durationLabel"
}
