package com.example.ui.settings

import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.BuildConfig
import com.example.core.common.DurationFormatter
import com.example.domain.model.AccountSyncState
import com.example.domain.model.AppThemeMode
import com.example.domain.model.AppUpdateUiState
import com.example.domain.model.AudioQuality
import com.example.playback.EqualizerState
import com.example.ui.account.YouTubeAccountViewModel
import com.example.ui.components.SonoraCard
import com.example.ui.components.SonoraFilterPill
import com.example.ui.components.SonoraIcons
import com.example.ui.components.SonoraSectionTitle
import com.example.ui.components.SonoraSettingsActionRow
import com.example.ui.components.SonoraSettingsDivider
import com.example.ui.components.SonoraSettingsSwitchRow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    onOpenYouTubeLogin: (resetSession: Boolean) -> Unit,
    bottomContentPadding: PaddingValues,
    onShowMessage: (String) -> Unit,
    onOpenAppUpdate: () -> Unit = {},
    onOpenEqualizer: () -> Unit = {},
    onOpenCacheQuality: () -> Unit = {},
    onOpenYouTubeAccount: () -> Unit = {},
    onOpenSignOutConfirm: () -> Unit = {},
    onOpenSecuritySettings: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel(),
    accountViewModel: YouTubeAccountViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val accountUiState by accountViewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var showSleepTimerSheet by remember { mutableStateOf(false) }
    var showBackupSheet by remember { mutableStateOf(false) }
    var showThemeSheet by remember { mutableStateOf(false) }
    var showExportPasswordDialog by remember { mutableStateOf(false) }
    var pendingExportPassword by remember { mutableStateOf<String?>(null) }
    var pendingEncryptedImportPayload by remember { mutableStateOf<String?>(null) }
    var passwordInput by remember { mutableStateOf("") }
    var passwordConfirmInput by remember { mutableStateOf("") }
    var passwordError by remember { mutableStateOf<String?>(null) }

    fun notifyRestoreSuccess(summary: com.example.data.repository.BackupRestoreSummary) {
        val parts = buildList {
            if (summary.tracksRestored > 0) add("треков: ${summary.tracksRestored}")
            if (summary.playlistsRestored > 0) add("плейлистов: ${summary.playlistsRestored}")
            if (summary.searchQueriesRestored > 0) add("запросов: ${summary.searchQueriesRestored}")
            if (summary.settingsRestored) add("настройки")
            if (summary.playbackRestored) add("очередь")
            if (summary.equalizerRestored) add("эквалайзер")
        }
        val msg = if (parts.isEmpty()) {
            "Резервная копия применена"
        } else {
            "Восстановлено (${parts.joinToString(", ")})"
        }
        onShowMessage(msg)
    }

    LaunchedEffect(Unit) {
        viewModel.refreshCacheSize()
    }

    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        val exportPwd = pendingExportPassword
        pendingExportPassword = null
        if (uri != null) {
            scope.launch {
                runCatching {
                    val payload = if (!exportPwd.isNullOrBlank()) {
                        viewModel.generateProtectedBackupJson(exportPwd)
                    } else {
                        viewModel.generateBackupJson()
                    }
                    withContext(Dispatchers.IO) {
                        val stream = context.contentResolver.openOutputStream(uri)
                            ?: error("Не удалось открыть файл для записи")
                        stream.use { out ->
                            out.write(payload.toByteArray(Charsets.UTF_8))
                            out.flush()
                        }
                    }
                }.onSuccess {
                    onShowMessage(
                        if (!exportPwd.isNullOrBlank()) {
                            "Зашифрованная резервная копия экспортирована"
                        } else {
                            "Резервная копия экспортирована"
                        }
                    )
                }.onFailure {
                    onShowMessage("Ошибка экспорта: ${it.localizedMessage}")
                }
            }
        }
    }

    val importLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) {
            scope.launch {
                val payload = withContext(Dispatchers.IO) {
                    runCatching {
                        context.contentResolver.openInputStream(uri)?.use { stream ->
                            val maxBytes = 10 * 1024 * 1024
                            val buffer = ByteArray(maxBytes + 1)
                            var totalRead = 0
                            while (totalRead < buffer.size) {
                                val count = stream.read(buffer, totalRead, buffer.size - totalRead)
                                if (count <= 0) break
                                totalRead += count
                            }
                            if (totalRead > maxBytes) {
                                throw IllegalArgumentException("Файл слишком большой")
                            }
                            String(buffer, 0, totalRead, Charsets.UTF_8)
                        }
                    }.getOrNull()
                }
                if (payload.isNullOrBlank()) {
                    onShowMessage("Не удалось прочитать файл или он слишком большой")
                } else if (viewModel.isEncryptedBackup(payload)) {
                    passwordInput = ""
                    passwordError = null
                    pendingEncryptedImportPayload = payload
                } else {
                    viewModel.restoreBackupPayload(payload, null) { result ->
                        result.fold(
                            onSuccess = ::notifyRestoreSuccess,
                            onFailure = {
                                onShowMessage("Некорректный JSON-файл резервной копии")
                            }
                        )
                    }
                }
            }
        }
    }

    if (showExportPasswordDialog) {
        AlertDialog(
            onDismissRequest = {
                showExportPasswordDialog = false
                passwordInput = ""
                passwordConfirmInput = ""
                passwordError = null
            },
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            title = { Text("Пароль для шифрования") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "Архив будет зашифрован по стандарту AES-256-GCM. Запомните пароль — без него восстановление невозможно.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OutlinedTextField(
                        value = passwordInput,
                        onValueChange = {
                            passwordInput = it
                            passwordError = null
                        },
                        label = { Text("Пароль (мин. 6 символов)") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("backup_export_password_input")
                    )
                    OutlinedTextField(
                        value = passwordConfirmInput,
                        onValueChange = {
                            passwordConfirmInput = it
                            passwordError = null
                        },
                        label = { Text("Подтвердите пароль") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("backup_export_password_confirm_input")
                    )
                    passwordError?.let { err ->
                        Text(
                            text = err,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        when {
                            passwordInput.length < 6 -> {
                                passwordError = "Минимум 6 символов"
                            }
                            passwordInput != passwordConfirmInput -> {
                                passwordError = "Пароли не совпадают"
                            }
                            else -> {
                                pendingExportPassword = passwordInput
                                showExportPasswordDialog = false
                                passwordInput = ""
                                passwordConfirmInput = ""
                                passwordError = null
                                exportLauncher.launch("sonora_library_backup.sonoraenc")
                            }
                        }
                    },
                    modifier = Modifier.testTag("backup_export_password_confirm_button")
                ) {
                    Text("Продолжить", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showExportPasswordDialog = false
                        passwordInput = ""
                        passwordConfirmInput = ""
                        passwordError = null
                    }
                ) {
                    Text("Отмена")
                }
            }
        )
    }

    val encryptedPayload = pendingEncryptedImportPayload
    if (encryptedPayload != null) {
        AlertDialog(
            onDismissRequest = {
                pendingEncryptedImportPayload = null
                passwordInput = ""
                passwordError = null
            },
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            title = { Text("Расшифровка копии") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        text = "Введите пароль, заданный при экспорте зашифрованной резервной копии.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OutlinedTextField(
                        value = passwordInput,
                        onValueChange = {
                            passwordInput = it
                            passwordError = null
                        },
                        label = { Text("Пароль") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("backup_import_password_input")
                    )
                    passwordError?.let { err ->
                        Text(
                            text = err,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        val secret = passwordInput
                        if (secret.isBlank()) {
                            passwordError = "Введите пароль"
                            return@Button
                        }
                        viewModel.restoreBackupPayload(encryptedPayload, secret) { result ->
                            result.fold(
                                onSuccess = { summary ->
                                    pendingEncryptedImportPayload = null
                                    passwordInput = ""
                                    passwordError = null
                                    notifyRestoreSuccess(summary)
                                },
                                onFailure = {
                                    passwordError = "Неверный пароль или файл повреждён"
                                }
                            )
                        }
                    },
                    modifier = Modifier.testTag("backup_import_password_confirm_button")
                ) {
                    Text("Восстановить", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        pendingEncryptedImportPayload = null
                        passwordInput = ""
                        passwordError = null
                    }
                ) {
                    Text("Отмена")
                }
            }
        )
    }

    if (showSleepTimerSheet) {
        ModalBottomSheet(
            onDismissRequest = { showSleepTimerSheet = false },
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "Таймер сна",
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                )
                Text(
                    text = uiState.playbackState.sleepTimerRemainingMs?.let { rem ->
                        "Остановка воспроизведения через ${DurationFormatter.formatMillis(rem)}"
                    } ?: "Плавное затухание громкости в последние 5 секунд перед паузой.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (uiState.playbackState.sleepTimerRemainingMs != null) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurfaceVariant
                    }
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    val timerOptions = listOf(0 to "Выкл", 15 to "15 мин", 30 to "30 мин", 45 to "45 мин", 60 to "60 мин")
                    timerOptions.forEach { (mins, label) ->
                        val active = mins == 0 && uiState.playbackState.sleepTimerRemainingMs == null
                        SonoraFilterPill(
                            label = label,
                            selected = active,
                            onClick = {
                                if (mins == 0) {
                                    viewModel.cancelSleepTimer()
                                    onShowMessage("Таймер сна отменён")
                                } else {
                                    viewModel.startSleepTimer(mins)
                                    onShowMessage("Таймер сна установлен на $mins мин")
                                }
                                showSleepTimerSheet = false
                            }
                        )
                    }
                }
            }
        }
    }

    if (showBackupSheet) {
        ModalBottomSheet(
            onDismissRequest = { showBackupSheet = false },
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "Резервная копия JSON",
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                )
                Text(
                    text = "Сохраняет избранное, плейлисты, историю, настройки аудио и активную очередь воспроизведения.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                SonoraCard(modifier = Modifier.fillMaxWidth()) {
                    SonoraSettingsActionRow(
                        title = if (uiState.settings.encryptBackupsEnabled) {
                            "Экспортировать зашифрованный архив"
                        } else {
                            "Экспортировать файл JSON"
                        },
                        subtitle = if (uiState.settings.encryptBackupsEnabled) {
                            "Защита AES-256 с паролем перед сохранением"
                        } else {
                            "Выбрать папку и имя архива вручную"
                        },
                        valueText = if (uiState.settings.encryptBackupsEnabled) "AES-256" else "Экспорт",
                        icon = SonoraIcons.FileUpload,
                        iconTint = MaterialTheme.colorScheme.primary,
                        onClick = {
                            showBackupSheet = false
                            if (uiState.settings.encryptBackupsEnabled) {
                                passwordInput = ""
                                passwordConfirmInput = ""
                                passwordError = null
                                showExportPasswordDialog = true
                            } else {
                                pendingExportPassword = null
                                exportLauncher.launch("sonora_library_backup.json")
                            }
                        },
                        modifier = Modifier.testTag("export_backup_button")
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsActionRow(
                        title = "Сохранить в Загрузки/Sonora",
                        subtitle = "Быстрый снимок медиатеки на устройстве",
                        valueText = "Сохранить",
                        icon = SonoraIcons.BookmarkAdd,
                        onClick = {
                            showBackupSheet = false
                            viewModel.saveBackupToDownloadsSnapshot { res ->
                                res.onSuccess { path ->
                                    onShowMessage("Копия сохранена: $path")
                                }.onFailure { err ->
                                    onShowMessage(err.localizedMessage ?: "Не удалось сохранить копию")
                                }
                            }
                        },
                        modifier = Modifier.testTag("save_downloads_backup_button")
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsActionRow(
                        title = "Восстановить из JSON",
                        subtitle = "Импортировать ранее сохранённую копию",
                        valueText = "Импорт",
                        icon = SonoraIcons.FileDownload,
                        onClick = {
                            showBackupSheet = false
                            importLauncher.launch(arrayOf("application/json", "*/*"))
                        },
                        modifier = Modifier.testTag("import_backup_button")
                    )
                }
            }
        }
    }

    if (showThemeSheet) {
        ModalBottomSheet(
            onDismissRequest = { showThemeSheet = false },
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp)
                    .padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text(
                    text = "Оформление интерфейса",
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    AppThemeMode.entries.forEach { mode ->
                        val themeLabel = when (mode) {
                            AppThemeMode.SYSTEM -> "Системная"
                            AppThemeMode.DARK -> "Тёмная (Obsidian)"
                            AppThemeMode.LIGHT -> "Светлая"
                        }
                        SonoraFilterPill(
                            label = themeLabel,
                            selected = uiState.settings.themeMode == mode,
                            onClick = { viewModel.setThemeMode(mode) }
                        )
                    }
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        SonoraSettingsSwitchRow(
                            title = "Динамические цвета Material You",
                            subtitle = "Адаптировать акценты под обои Android",
                            icon = SonoraIcons.ColorLens,
                            checked = uiState.settings.dynamicColorEnabled,
                            onCheckedChange = viewModel::setDynamicColorEnabled,
                            testTag = "toggle_dynamic_color"
                        )
                    }
                }
            }
        }
    }

    val activeAccount = accountUiState.activeAccount
    val isSyncing = accountUiState.syncState is AccountSyncState.Syncing
    val qualityShortLabel = when (uiState.settings.audioQuality) {
        AudioQuality.HIGH -> "320 kbps"
        AudioQuality.BALANCED -> "128 kbps"
        AudioQuality.DATA_SAVER -> "64 kbps"
    }
    val eqValueText = if (uiState.equalizerState.isEnabled) {
        uiState.equalizerState.activePresetLabel
    } else {
        "Выкл"
    }
    val timerLabel = uiState.playbackState.sleepTimerRemainingMs?.let {
        DurationFormatter.formatMillis(it)
    } ?: "Выкл"
    val themeShortLabel = when (uiState.settings.themeMode) {
        AppThemeMode.DARK -> "Obsidian"
        AppThemeMode.SYSTEM -> "Системная"
        AppThemeMode.LIGHT -> "Светлая"
    }
    val totalStorageLabel = DurationFormatter.formatBytes(uiState.totalStorageBytes)
    val streamCacheLabel = DurationFormatter.formatBytes(uiState.cacheSizeBytes)
    val backupValueLabel = if (uiState.favoritesCount > 0 || uiState.playlistsCount > 0) {
        "${uiState.favoritesCount} избр. • ${uiState.playlistsCount} пл."
    } else {
        "JSON"
    }
    val lastSyncShort = remember(activeAccount?.lastSyncTimestamp) {
        val ts = activeAccount?.lastSyncTimestamp ?: 0L
        if (ts > 0L) {
            SimpleDateFormat("d MMM, HH:mm", Locale.forLanguageTag("ru")).format(Date(ts))
        } else {
            null
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentPadding = PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = 12.dp,
            bottom = bottomContentPadding.calculateBottomPadding() + 20.dp
        ),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Text(
                text = "Настройки",
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onBackground
            )
        }

        // АККАУНТ
        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SonoraSectionTitle(title = "АККАУНТ")
                SonoraCard(modifier = Modifier.fillMaxWidth()) {
                    SonoraSettingsActionRow(
                        title = "YouTube Music",
                        subtitle = if (activeAccount != null) {
                            activeAccount.email.ifBlank { activeAccount.name }
                        } else {
                            "Войдите для синхронизации лайков и плейлистов"
                        },
                        valueText = if (activeAccount != null) {
                            if (accountUiState.accounts.size > 1) {
                                "${accountUiState.accounts.size} проф."
                            } else {
                                "Синхронизировано"
                            }
                        } else {
                            "Войти"
                        },
                        icon = SonoraIcons.AccountCircle,
                        iconTint = if (activeAccount != null) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        onClick = onOpenYouTubeAccount,
                        modifier = Modifier.testTag("youtube_account_hub_row")
                    )

                    SonoraSettingsDivider()

                    SonoraSettingsSwitchRow(
                        title = "Автосинхронизация плейлистов",
                        subtitle = "Обновлять избранное при запуске",
                        icon = SonoraIcons.Sync,
                        checked = accountUiState.autoSyncEnabled,
                        onCheckedChange = accountViewModel::setAutoSyncEnabled,
                        testTag = "toggle_youtube_autosync"
                    )

                    SonoraSettingsDivider()

                    SonoraSettingsActionRow(
                        title = "Импорт истории и треков",
                        subtitle = when (val syncState = accountUiState.syncState) {
                            is AccountSyncState.Syncing -> syncState.stage
                            is AccountSyncState.Completed -> "+${syncState.summary.importedLiked} лайков, +${syncState.summary.importedPlaylists} плейлистов"
                            is AccountSyncState.Error -> syncState.message
                            else -> "Синхронизация с серверами Google"
                        },
                        valueText = when {
                            isSyncing -> "Синхр..."
                            lastSyncShort != null -> lastSyncShort
                            activeAccount != null -> "Обновить"
                            else -> "Открыть"
                        },
                        icon = SonoraIcons.CloudDownload,
                        iconTint = when {
                            isSyncing -> MaterialTheme.colorScheme.primary
                            accountUiState.syncState is AccountSyncState.Error -> MaterialTheme.colorScheme.error
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        onClick = {
                            if (activeAccount != null) {
                                if (!isSyncing) accountViewModel.syncAndMergeActiveAccount(onShowMessage)
                            } else {
                                onOpenYouTubeAccount()
                            }
                        },
                        modifier = Modifier.testTag("youtube_sync_merge_button")
                    )

                    if (accountUiState.syncState is AccountSyncState.Syncing) {
                        val s = accountUiState.syncState as AccountSyncState.Syncing
                        LinearProgressIndicator(
                            progress = { s.progress.coerceIn(0.05f, 1f) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 14.dp, vertical = 8.dp),
                            color = MaterialTheme.colorScheme.primary,
                            trackColor = MaterialTheme.colorScheme.surfaceContainerHighest
                        )
                    }
                }
            }
        }

        // СИНХРОНИЗАЦИЯ И АУДИО
        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SonoraSectionTitle(title = "СИНХРОНИЗАЦИЯ И АУДИО")
                SonoraCard(modifier = Modifier.fillMaxWidth()) {
                    SonoraSettingsActionRow(
                        title = "Качество кэша и память",
                        subtitle = if (uiState.offlineTracksCount > 0) {
                            "Поток, автозагрузка и ${DurationFormatter.formatTrackCount(uiState.offlineTracksCount)} офлайн"
                        } else {
                            "Битрейт, кэш и офлайн-загрузки"
                        },
                        valueText = if (uiState.totalStorageBytes > 0L) {
                            "$qualityShortLabel • $totalStorageLabel"
                        } else {
                            qualityShortLabel
                        },
                        icon = SonoraIcons.HighQuality,
                        iconTint = MaterialTheme.colorScheme.primary,
                        onClick = onOpenCacheQuality,
                        modifier = Modifier.testTag("open_cache_quality_button")
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsSwitchRow(
                        title = "Умная очередь",
                        subtitle = "Бесконечный автоподбор треков радио",
                        icon = SonoraIcons.AutoMode,
                        checked = uiState.settings.autoplayEnabled,
                        onCheckedChange = viewModel::setAutoplayEnabled,
                        testTag = "toggle_autoplay"
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsSwitchRow(
                        title = "Плавный переход (Gapless)",
                        subtitle = "Без пауз между треками и плавное затухание",
                        icon = SonoraIcons.GraphicEq,
                        checked = uiState.settings.gaplessPlaybackEnabled,
                        onCheckedChange = viewModel::setGaplessPlaybackEnabled,
                        testTag = "toggle_gapless_playback"
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsSwitchRow(
                        title = "Пропуск тишины",
                        subtitle = "Сокращать тихие паузы в треках и подкастах",
                        icon = SonoraIcons.Speed,
                        checked = uiState.settings.skipSilenceEnabled,
                        onCheckedChange = viewModel::setSkipSilenceEnabled,
                        testTag = "toggle_skip_silence"
                    )
                }
            }
        }

        // ПРОФИЛЬ И ОБРАБОТКА
        item {
            val isCheckingUpdate = uiState.updateState is AppUpdateUiState.Checking
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SonoraSectionTitle(title = "ПРОФИЛЬ И ВЕРСИЯ")
                SonoraCard(modifier = Modifier.fillMaxWidth()) {
                    SonoraSettingsActionRow(
                        title = "5-полосный эквалайзер",
                        subtitle = "Настройка частот, баса и Spatial Audio",
                        valueText = eqValueText,
                        icon = SonoraIcons.Equalizer,
                        iconTint = if (uiState.equalizerState.isEnabled) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        onClick = onOpenEqualizer,
                        modifier = Modifier.testTag("open_equalizer_button")
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsActionRow(
                        title = "Резервная копия JSON",
                        subtitle = "Сохранить или восстановить медиатеку",
                        valueText = backupValueLabel,
                        icon = SonoraIcons.FileUpload,
                        onClick = { showBackupSheet = true },
                        modifier = Modifier.testTag("open_backup_sheet_button")
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsActionRow(
                        title = "Безопасность и защита",
                        subtitle = "Шифрование, HTTPS (TLS 1.2+), целостность и приватность",
                        valueText = if (uiState.settings.encryptBackupsEnabled) "TLS • AES" else "TLS 1.2+",
                        icon = SonoraIcons.Shield,
                        iconTint = MaterialTheme.colorScheme.primary,
                        onClick = onOpenSecuritySettings,
                        modifier = Modifier.testTag("open_security_settings_button")
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsActionRow(
                        title = "Версия приложения",
                        subtitle = if (isCheckingUpdate) {
                            "Проверка обновлений Sonora..."
                        } else {
                            "Обновления и список изменений Sonora"
                        },
                        valueText = "v${BuildConfig.VERSION_NAME}",
                        icon = Icons.Rounded.Refresh,
                        onClick = onOpenAppUpdate,
                        modifier = Modifier.testTag("open_app_update_button")
                    )
                }
            }
        }

        // СИСТЕМА И ПАМЯТЬ
        item {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SonoraSectionTitle(title = "СИСТЕМА И ПАМЯТЬ")
                SonoraCard(modifier = Modifier.fillMaxWidth()) {
                    SonoraSettingsActionRow(
                        title = "Таймер сна",
                        subtitle = "Плавное затухание звука перед паузой",
                        valueText = timerLabel,
                        icon = SonoraIcons.Bedtime,
                        iconTint = if (uiState.playbackState.sleepTimerRemainingMs != null) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        onClick = { showSleepTimerSheet = true },
                        modifier = Modifier.testTag("open_sleep_timer_button")
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsActionRow(
                        title = "Оформление",
                        subtitle = "Тема интерфейса и Material You",
                        valueText = themeShortLabel,
                        icon = SonoraIcons.Palette,
                        onClick = { showThemeSheet = true },
                        modifier = Modifier.testTag("open_theme_sheet_button")
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsActionRow(
                        title = "Очистить потоковый кэш",
                        subtitle = "Временный буфер воспроизведения (офлайн-треки сохранятся)",
                        valueText = streamCacheLabel,
                        icon = SonoraIcons.CleaningServices,
                        onClick = {
                            viewModel.clearCache { onShowMessage("Потоковый кэш очищен") }
                        },
                        modifier = Modifier.testTag("clear_cache_button")
                    )
                }
            }
        }
    }
}

@Composable
fun EqualizerSheetContent(
    state: EqualizerState,
    onToggleEnabled: (Boolean) -> Unit,
    onSelectPreset: (Int) -> Unit,
    onBandChange: (Int, Short) -> Unit,
    onBassBoostChange: (Int) -> Unit = {},
    onVirtualizerChange: (Boolean) -> Unit = {},
    onReset: (() -> Unit)? = null
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Эквалайзер",
                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onBackground
            )
            if (onReset != null) {
                TextButton(onClick = onReset) {
                    Text("Сброс", color = MaterialTheme.colorScheme.primary)
                }
            }
        }

        EqualizerControlsCardAndSliders(
            state = state,
            onToggleEnabled = onToggleEnabled,
            onSelectPreset = onSelectPreset,
            onBassBoostChange = onBassBoostChange,
            onVirtualizerChange = onVirtualizerChange,
            onBandChange = onBandChange
        )
    }
}
