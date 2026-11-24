package com.example.ui.account

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.R
import com.example.domain.model.AccountSyncState
import com.example.ui.components.SonoraCard
import com.example.ui.components.SonoraIcons
import com.example.ui.components.SonoraSectionTitle
import com.example.ui.components.SonoraSettingsActionRow
import com.example.ui.components.SonoraSettingsDivider
import com.example.ui.components.SonoraSettingsSwitchRow
import java.text.DateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun YouTubeAccountSettingsCard(
    uiState: YouTubeAccountUiState,
    onOpenLogin: (addAnother: Boolean) -> Unit,
    onSwitchAccount: (String) -> Unit,
    onRemoveAccount: (String) -> Unit,
    onToggleAutoSync: (Boolean) -> Unit,
    onSyncNow: () -> Unit,
    onUnifyAllAccounts: () -> Unit,
    onImportCookies: (String, () -> Unit) -> Unit,
    onSignOutAll: () -> Unit,
    onOpenAccountDetails: (() -> Unit)? = null
) {
    var showCookieDialog by remember { mutableStateOf(false) }

    if (showCookieDialog) {
        CookieImportDialog(
            isLoading = uiState.isSigningIn,
            onDismiss = { showCookieDialog = false },
            onSubmit = { rawCookies ->
                onImportCookies(rawCookies) {
                    showCookieDialog = false
                }
            }
        )
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SonoraSectionTitle(title = "АККАУНТ YOUTUBE")

        val active = uiState.activeAccount
        val isSyncing = uiState.syncState is AccountSyncState.Syncing

        if (active == null) {
            SonoraCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(44.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f))
                                .border(1.5.dp, MaterialTheme.colorScheme.primary, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = SonoraIcons.AccountCircle,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(24.dp)
                            )
                        }
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Аккаунт YouTube Music",
                                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = "Синхронизация лайков, плейлистов и истории между устройствами",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    Button(
                        onClick = { onOpenLogin(false) },
                        enabled = !uiState.isSigningIn,
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp)
                            .testTag("youtube_sign_in_button")
                    ) {
                        Icon(SonoraIcons.AccountCircle, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Войти в аккаунт YouTube", fontWeight = FontWeight.Bold)
                    }

                    OutlinedButton(
                        onClick = { showCookieDialog = true },
                        shape = CircleShape,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(46.dp)
                            .testTag("youtube_cookie_login_button")
                    ) {
                        Icon(
                            imageVector = SonoraIcons.Key,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Войти через Cookie браузера")
                    }
                }
            }
        } else {
            SonoraCard(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .let { mod ->
                            if (onOpenAccountDetails != null) mod.clickable(onClick = onOpenAccountDetails) else mod
                        }
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(84.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
                        contentAlignment = Alignment.Center
                    ) {
                        Surface(
                            modifier = Modifier
                                .size(70.dp)
                                .border(
                                    width = 2.dp,
                                    color = MaterialTheme.colorScheme.primary,
                                    shape = CircleShape
                                ),
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.surfaceContainerHigh
                        ) {
                            if (active.avatarUrl.isNotBlank()) {
                                AsyncImage(
                                    model = active.avatarUrl,
                                    contentDescription = "Аватар ${active.name}",
                                    placeholder = painterResource(R.drawable.img_default_cover),
                                    error = painterResource(R.drawable.img_default_cover),
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize()
                                )
                            } else {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        imageVector = SonoraIcons.AccountCircle,
                                        contentDescription = active.name,
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(34.dp)
                                    )
                                }
                            }
                        }
                    }

                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        Text(
                            text = active.name,
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.ExtraBold),
                            color = MaterialTheme.colorScheme.onBackground,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = TextAlign.Center
                        )
                        val subtitle = listOf(active.handle, active.email)
                            .filter { it.isNotBlank() }
                            .joinToString(" • ")
                        if (subtitle.isNotBlank()) {
                            Text(
                                text = subtitle,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                textAlign = TextAlign.Center
                            )
                        }
                        val syncTimeText = remember(active.lastSyncTimestamp) {
                            if (active.lastSyncTimestamp > 0L) {
                                val fmt = DateFormat.getDateTimeInstance(
                                    DateFormat.SHORT,
                                    DateFormat.SHORT,
                                    Locale.getDefault()
                                )
                                "Синхронизировано • ${fmt.format(Date(active.lastSyncTimestamp))}"
                            } else {
                                "Подключено • готово к синхронизации"
                            }
                        }
                        Text(
                            text = syncTimeText,
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.primary
                        )
                    }

                    Button(
                        onClick = onSyncNow,
                        enabled = !isSyncing,
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary
                        ),
                        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp)
                            .testTag("youtube_sync_merge_button")
                    ) {
                        if (isSyncing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Синхронизация...", fontWeight = FontWeight.Bold)
                        } else {
                            Icon(SonoraIcons.Sync, contentDescription = null)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Синхронизировать с YouTube", fontWeight = FontWeight.Bold)
                        }
                    }

                    when (val syncState = uiState.syncState) {
                        is AccountSyncState.Syncing -> {
                            Column(
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                LinearProgressIndicator(
                                    progress = { syncState.progress.coerceIn(0.05f, 1f) },
                                    modifier = Modifier.fillMaxWidth(),
                                    color = MaterialTheme.colorScheme.primary,
                                    trackColor = MaterialTheme.colorScheme.surfaceContainerHighest
                                )
                                Text(
                                    text = syncState.stage,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }

                        is AccountSyncState.Completed -> {
                            val s = syncState.summary
                            Text(
                                text = "Готово • +${s.importedLiked} лайков из YT, ↑${s.uploadedLiked} в YT, +${s.importedPlaylists} / ↑${s.uploadedPlaylists} плейлистов",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                                textAlign = TextAlign.Center
                            )
                        }

                        is AccountSyncState.Error -> {
                            Text(
                                text = syncState.message,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                                textAlign = TextAlign.Center
                            )
                        }

                        AccountSyncState.Idle -> Unit
                    }

                    if (uiState.accounts.size > 1) {
                        Column(
                            modifier = Modifier.fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                text = "Подключённые аккаунты (${uiState.accounts.size})",
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                uiState.accounts.forEach { account ->
                                    val isSelected = account.id == active.id
                                    FilterChip(
                                        selected = isSelected,
                                        onClick = { if (!isSelected) onSwitchAccount(account.id) },
                                        shape = CircleShape,
                                        label = {
                                            Text(
                                                text = account.name,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        },
                                        trailingIcon = if (!isSelected) {
                                            {
                                                Box(
                                                    contentAlignment = Alignment.Center,
                                                    modifier = Modifier
                                                        .size(26.dp)
                                                        .clip(CircleShape)
                                                        .clickable { onRemoveAccount(account.id) }
                                                ) {
                                                    Icon(
                                                        imageVector = Icons.Rounded.Close,
                                                        contentDescription = "Удалить ${account.name}",
                                                        modifier = Modifier.size(16.dp)
                                                    )
                                                }
                                            }
                                        } else {
                                            null
                                        },
                                        colors = FilterChipDefaults.filterChipColors(
                                            selectedContainerColor = MaterialTheme.colorScheme.onBackground,
                                            selectedLabelColor = MaterialTheme.colorScheme.background,
                                            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                                            labelColor = MaterialTheme.colorScheme.onSurface
                                        ),
                                        border = null
                                    )
                                }
                            }
                            if (uiState.accounts.size >= 2) {
                                OutlinedButton(
                                    onClick = onUnifyAllAccounts,
                                    enabled = !isSyncing,
                                    shape = CircleShape,
                                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.6f)),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(46.dp)
                                        .testTag("youtube_unify_all_accounts_button")
                                ) {
                                    Icon(SonoraIcons.MergeType, contentDescription = null)
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = "Объединить все аккаунты в «${active.name}»",
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                        }
                    }
                }
            }

            SonoraCard(modifier = Modifier.fillMaxWidth()) {
                if (onOpenAccountDetails != null) {
                    SonoraSettingsActionRow(
                        title = "Управление аккаунтом YouTube",
                        subtitle = "Статус профиля, импорт и параметры выхода",
                        valueText = "Профиль",
                        icon = SonoraIcons.AccountCircle,
                        iconTint = MaterialTheme.colorScheme.primary,
                        onClick = onOpenAccountDetails,
                        modifier = Modifier.testTag("youtube_open_account_details_button")
                    )
                    SonoraSettingsDivider()
                }
                SonoraSettingsSwitchRow(
                    title = "Автосохранение на YouTube",
                    subtitle = "Сохранять лайки и новые плейлисты в ваш аккаунт YouTube",
                    icon = SonoraIcons.Sync,
                    checked = uiState.autoSyncEnabled,
                    onCheckedChange = onToggleAutoSync,
                    testTag = "toggle_youtube_autosync"
                )
                SonoraSettingsDivider()
                SonoraSettingsActionRow(
                    title = "Добавить ещё аккаунт",
                    subtitle = "Подключить второй профиль YouTube Music",
                    icon = Icons.Rounded.Add,
                    onClick = { if (!isSyncing) onOpenLogin(true) },
                    modifier = Modifier.testTag("youtube_add_another_account_button")
                )
                SonoraSettingsDivider()
                SonoraSettingsActionRow(
                    title = "Выйти из аккаунта",
                    subtitle = "Сбросить подключение к YouTube Music",
                    icon = SonoraIcons.Logout,
                    iconTint = MaterialTheme.colorScheme.error,
                    valueText = "Выход",
                    onClick = { if (!isSyncing) onSignOutAll() },
                    modifier = Modifier.testTag("youtube_sign_out_button")
                )
            }
        }
    }
}

@Composable
fun LibraryAccountSyncBanner(
    uiState: YouTubeAccountUiState,
    onOpenLogin: () -> Unit,
    onSyncNow: () -> Unit
) {
    val active = uiState.activeAccount
    val isSyncing = uiState.syncState is AccountSyncState.Syncing

    SonoraCard(
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (active != null) {
                    AsyncImage(
                        model = active.avatarUrl.ifBlank { null },
                        contentDescription = active.name,
                        placeholder = painterResource(R.drawable.img_default_cover),
                        error = painterResource(R.drawable.img_default_cover),
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .border(1.5.dp, MaterialTheme.colorScheme.primary, CircleShape)
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = active.name,
                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        val statusText = when (val s = uiState.syncState) {
                            is AccountSyncState.Syncing -> s.stage
                            else -> if (uiState.accounts.size > 1) {
                                "Аккаунтов: ${uiState.accounts.size} • Нажмите для синхр."
                            } else {
                                "YouTube синхронизация активна"
                            }
                        }
                        Text(
                            text = statusText,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    OutlinedButton(
                        onClick = onSyncNow,
                        enabled = !isSyncing,
                        shape = CircleShape,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                        modifier = Modifier.testTag("library_sync_youtube_button")
                    ) {
                        if (isSyncing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(
                                imageVector = SonoraIcons.Sync,
                                contentDescription = "Синхронизировать",
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Синхр.")
                        }
                    }
                } else {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f))
                            .border(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.6f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = SonoraIcons.AccountCircle,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Аккаунт YouTube",
                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold)
                        )
                        Text(
                            text = "Войдите и объедините музыку с YouTube",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    Button(
                        onClick = onOpenLogin,
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary
                        ),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        modifier = Modifier.testTag("library_connect_youtube_button")
                    ) {
                        Text("Войти", fontWeight = FontWeight.Bold)
                    }
                }
            }

            if (uiState.syncState is AccountSyncState.Syncing) {
                Spacer(modifier = Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { uiState.syncState.progress.coerceIn(0.05f, 1f) },
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceContainerHighest
                )
            }
        }
    }
}

@Composable
private fun CookieImportDialog(
    isLoading: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit
) {
    var cookieInput by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = { if (!isLoading) onDismiss() },
        containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        title = { Text("Вход через Cookie YouTube") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Вставьте заголовок Cookie с music.youtube.com (должен содержать SAPISID и SID) или содержимое Netscape cookies.txt.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                OutlinedTextField(
                    value = cookieInput,
                    onValueChange = { cookieInput = it },
                    label = { Text("Cookie / cookies.txt") },
                    minLines = 3,
                    maxLines = 6,
                    shape = RoundedCornerShape(14.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                        unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("cookie_input_field")
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSubmit(cookieInput) },
                enabled = cookieInput.isNotBlank() && !isLoading,
                shape = CircleShape,
                modifier = Modifier.testTag("confirm_cookie_login_button")
            ) {
                if (isLoading) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                } else {
                    Text("Подключить", fontWeight = FontWeight.Bold)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !isLoading) {
                Text("Отмена")
            }
        }
    )
}
