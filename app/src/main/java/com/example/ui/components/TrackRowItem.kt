package com.example.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.example.R
import com.example.core.common.DurationFormatter
import com.example.domain.model.Track

@Composable
fun TrackRowItem(
    track: Track,
    isCurrentTrack: Boolean,
    isFavorite: Boolean,
    isDownloaded: Boolean = false,
    isDownloading: Boolean = false,
    onPlayClick: () -> Unit,
    onFavoriteClick: () -> Unit,
    onPlayNextClick: (() -> Unit)? = null,
    onStartRadioClick: (() -> Unit)? = null,
    onDownloadClick: (() -> Unit)? = null,
    onAddToPlaylistClick: (() -> Unit)? = null,
    onRemoveFromPlaylistClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    var menuExpanded by remember { mutableStateOf(false) }
    val hasMenuActions = onPlayNextClick != null ||
        onStartRadioClick != null ||
        onDownloadClick != null ||
        onAddToPlaylistClick != null ||
        onRemoveFromPlaylistClick != null

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onPlayClick)
            .testTag("track_row_${track.id}"),
        shape = RoundedCornerShape(14.dp),
        color = if (isCurrentTrack) {
            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.28f)
        } else {
            MaterialTheme.colorScheme.surfaceContainerLow
        },
        border = BorderStroke(
            width = 1.dp,
            color = if (isCurrentTrack) {
                MaterialTheme.colorScheme.primary.copy(alpha = 0.45f)
            } else {
                MaterialTheme.colorScheme.outline.copy(alpha = 0.45f)
            }
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 10.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            val context = LocalContext.current
            val artworkRequest = remember(track.thumbnailUrl) {
                ImageRequest.Builder(context)
                    .data(track.thumbnailUrl)
                    .size(162)
                    .crossfade(true)
                    .build()
            }
            Box(
                modifier = Modifier
                    .size(50.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh),
                contentAlignment = Alignment.Center
            ) {
                AsyncImage(
                    model = artworkRequest,
                    contentDescription = "Обложка ${track.title}",
                    placeholder = painterResource(R.drawable.img_default_cover),
                    error = painterResource(R.drawable.img_default_cover),
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(50.dp)
                )
                if (isCurrentTrack) {
                    Box(
                        modifier = Modifier
                            .matchParentSize()
                            .background(MaterialTheme.colorScheme.background.copy(alpha = 0.60f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = SonoraIcons.GraphicEq,
                            contentDescription = "Сейчас играет",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(22.dp)
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.width(12.dp))

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                Text(
                    text = track.title,
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = if (isCurrentTrack) FontWeight.Bold else FontWeight.SemiBold
                    ),
                    color = if (isCurrentTrack) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (isDownloaded) {
                        Icon(
                            imageVector = SonoraIcons.DownloadDone,
                            contentDescription = "Скачано",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(13.dp)
                        )
                    }
                    Text(
                        text = track.artist,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    if (track.durationSeconds > 0L) {
                        Text(
                            text = "• ${DurationFormatter.formatSeconds(track.durationSeconds)}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
                        )
                    }
                }
            }

            if (isDownloading) {
                Box(
                    modifier = Modifier.size(48.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }

            IconButton(
                onClick = onFavoriteClick,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .testTag("favorite_button_${track.id}")
            ) {
                Icon(
                    imageVector = if (isFavorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder,
                    contentDescription = if (isFavorite) "Убрать из избранного" else "В избранное",
                    tint = if (isFavorite) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    },
                    modifier = Modifier.size(20.dp)
                )
            }

            if (hasMenuActions) {
                Box {
                    IconButton(
                        onClick = { menuExpanded = true },
                        modifier = Modifier
                            .minimumInteractiveComponentSize()
                            .testTag("track_more_${track.id}")
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.MoreVert,
                            contentDescription = "Опции трека",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    DropdownMenu(
                        expanded = menuExpanded,
                        onDismissRequest = { menuExpanded = false }
                    ) {
                        if (onPlayNextClick != null) {
                            DropdownMenuItem(
                                text = { Text("Включить далее") },
                                leadingIcon = {
                                    Icon(SonoraIcons.QueueMusic, contentDescription = null)
                                },
                                onClick = {
                                    menuExpanded = false
                                    onPlayNextClick()
                                }
                            )
                        }
                        if (onStartRadioClick != null) {
                            DropdownMenuItem(
                                text = { Text("Запустить радио") },
                                leadingIcon = {
                                    Icon(SonoraIcons.Radio, contentDescription = null)
                                },
                                onClick = {
                                    menuExpanded = false
                                    onStartRadioClick()
                                }
                            )
                        }
                        if (onAddToPlaylistClick != null) {
                            DropdownMenuItem(
                                text = { Text("Добавить в плейлист") },
                                leadingIcon = {
                                    Icon(SonoraIcons.PlaylistAdd, contentDescription = null)
                                },
                                onClick = {
                                    menuExpanded = false
                                    onAddToPlaylistClick()
                                }
                            )
                        }
                        if (onDownloadClick != null) {
                            DropdownMenuItem(
                                text = {
                                    Text(if (isDownloaded) "Удалить офлайн-копию" else "Скачать офлайн")
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = if (isDownloaded) {
                                            SonoraIcons.DownloadDone
                                        } else {
                                            SonoraIcons.DownloadForOffline
                                        },
                                        contentDescription = null
                                    )
                                },
                                onClick = {
                                    menuExpanded = false
                                    onDownloadClick()
                                }
                            )
                        }
                        if (onRemoveFromPlaylistClick != null) {
                            DropdownMenuItem(
                                text = { Text("Удалить из плейлиста") },
                                leadingIcon = {
                                    Icon(SonoraIcons.DeleteOutline, contentDescription = null)
                                },
                                onClick = {
                                    menuExpanded = false
                                    onRemoveFromPlaylistClick()
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
