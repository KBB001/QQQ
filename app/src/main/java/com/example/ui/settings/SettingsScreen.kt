package com.example.ui.settings

import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.BuildConfig
import com.example.core.common.ApkInstallCompatibility
import com.example.core.common.ApkInstaller
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
import java.io.File
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
    viewModel: SettingsViewModel = hiltViewModel(),
    accountViewModel: YouTubeAccountViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val accountUiState by accountViewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var showEqualizerSheet by remember { mutableStateOf(false) }
    var showAudioQualitySheet by remember { mutableStateOf(false) }
    var showSleepTimerSheet by remember { mutableStateOf(false) }
    var showBackupSheet by remember { mutableStateOf(false) }
    var showThemeSheet by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.refreshCacheSize()
    }

    val exportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri != null) {
            scope.launch {
                runCatching {
                    val json = viewModel.generateBackupJson()
                    withContext(Dispatchers.IO) {
                        val stream = context.contentResolver.openOutputStream(uri)
                            ?: error("Не удалось открыть файл для записи")
                        stream.use { out ->
                            out.write(json.toByteArray(Charsets.UTF_8))
                            out.flush()
                        }
                    }
                }.onSuccess {
                    onShowMessage("Резервная копия экспортирована")
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
                val json = withContext(Dispatchers.IO) {
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
                if (json.isNullOrBlank()) {
                    onShowMessage("Не удалось прочитать файл или он слишком большой")
                } else {
                    viewModel.restoreBackupJson(json) { result ->
                        result.fold(
                            onSuccess = { summary ->
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
                            },
                            onFailure = {
                                onShowMessage("Некорректный JSON-файл резервной копии")
                            }
                        )
                    }
                }
            }
        }
    }

    var pendingInstallFile by remember { mutableStateOf<File?>(null) }
    var savedMismatchApkName by remember { mutableStateOf<String?>(null) }

    val installPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) {
        val file = pendingInstallFile
        if (file != null && file.exists() && ApkInstaller.canRequestPackageInstalls(context)) {
            ApkInstaller.launchApkInstaller(context, file).onFailure { err ->
                onShowMessage("Не удалось открыть установщик: ${err.localizedMessage}")
            }
            pendingInstallFile = null
        } else if (file != null && !ApkInstaller.canRequestPackageInstalls(context)) {
            onShowMessage("Разрешите установку из этого источника, чтобы установить обновление")
        }
    }

    fun triggerApkInstall(file: File, bypassCompatibilityCheck: Boolean = false) {
        if (!bypassCompatibilityCheck) {
            when (val check = ApkInstaller.checkInstallCompatibility(context, file)) {
                is ApkInstallCompatibility.InvalidArchive -> {
                    onShowMessage("APK-файл повреждён или неполный. Повторите загрузку обновления.")
                    return
                }
                is ApkInstallCompatibility.PackageMismatch -> {
                    onShowMessage("Скачанный APK относится к другому пакету (${check.archivePackage}).")
                    return
                }
                is ApkInstallCompatibility.SignatureMismatch,
                is ApkInstallCompatibility.VersionDowngrade -> {
                    onShowMessage("Этот APK нельзя установить поверх текущей версии. Сохраните его в «Загрузки» и переустановите приложение.")
                    return
                }
                ApkInstallCompatibility.Compatible -> Unit
            }
        }
        if (ApkInstaller.canRequestPackageInstalls(context)) {
            ApkInstaller.launchApkInstaller(context, file).onFailure { err ->
                onShowMessage("Не удалось запустить установщик: ${err.localizedMessage}")
            }
        } else {
            pendingInstallFile = file
            onShowMessage("Разрешите установку пакетов для Sonora в открывшемся окне")
            installPermissionLauncher.launch(ApkInstaller.createUnknownSourcesSettingsIntent(context))
        }
    }

    when (val updateState = uiState.updateState) {
        is AppUpdateUiState.Available -> {
            AlertDialog(
                onDismissRequest = viewModel::dismissUpdateDialog,
                containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                title = { Text("Доступно обновление ${updateState.info.tagName}") },
                text = {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(max = 280.dp)
                            .verticalScroll(rememberScrollState())
                    ) {
                        Text(
                            text = "Текущая версия: v${BuildConfig.VERSION_NAME}",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.primary
                        )
                        Text(
                            text = updateState.info.releaseNotes,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                confirmButton = {
                    Button(
                        onClick = {
                            savedMismatchApkName = null
                            viewModel.startUpdateDownload(
                                info = updateState.info,
                                onReadyToInstall = { downloadedFile ->
                                    if (ApkInstaller.checkInstallCompatibility(context, downloadedFile)
                                        is ApkInstallCompatibility.Compatible
                                    ) {
                                        triggerApkInstall(downloadedFile)
                                    }
                                },
                                onError = onShowMessage
                            )
                        },
                        shape = CircleShape,
                        modifier = Modifier.testTag("confirm_download_update_button")
                    ) {
                        Text("Скачать и установить", fontWeight = FontWeight.Bold)
                    }
                },
                dismissButton = {
                    TextButton(onClick = viewModel::dismissUpdateDialog) {
                        Text("Позже")
                    }
                }
            )
        }

        is AppUpdateUiState.Downloading -> {
            AlertDialog(
                onDismissRequest = {},
                containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                title = { Text("Загрузка ${updateState.info.tagName}") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (updateState.progress >= 0f) {
                            LinearProgressIndicator(
                                progress = { updateState.progress },
                                modifier = Modifier.fillMaxWidth(),
                                color = MaterialTheme.colorScheme.primary,
                                trackColor = MaterialTheme.colorScheme.surfaceContainerHighest
                            )
                            val pct = (updateState.progress * 100).toInt()
                            val downloadedMb = updateState.downloadedBytes / (1024f * 1024f)
                            val totalMb = updateState.totalBytes / (1024f * 1024f)
                            Text(
                                text = String.format(
                                    Locale.US,
                                    "%d%% (%.1f / %.1f МБ)",
                                    pct,
                                    downloadedMb,
                                    totalMb
                                ),
                                style = MaterialTheme.typography.bodyMedium
                            )
                        } else {
                            LinearProgressIndicator(
                                modifier = Modifier.fillMaxWidth(),
                                color = MaterialTheme.colorScheme.primary,
                                trackColor = MaterialTheme.colorScheme.surfaceContainerHighest
                            )
                            val downloadedMb = updateState.downloadedBytes / (1024f * 1024f)
                            Text(
                                text = String.format(Locale.US, "Загружено %.1f МБ...", downloadedMb),
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                },
                confirmButton = {},
                dismissButton = {
                    TextButton(onClick = viewModel::dismissUpdateDialog) {
                        Text("Отмена")
                    }
                }
            )
        }

        is AppUpdateUiState.ReadyToInstall -> {
            val compatibility = remember(updateState.apkFile) {
                ApkInstaller.checkInstallCompatibility(context, updateState.apkFile)
            }
            val closeDialog = {
                savedMismatchApkName = null
                viewModel.dismissUpdateDialog()
            }
            AlertDialog(
                onDismissRequest = closeDialog,
                containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
                title = {
                    Text(
                        when {
                            savedMismatchApkName != null ->
                                "Файл сохранён в «Загрузки»"
                            compatibility is ApkInstallCompatibility.InvalidArchive ->
                                "Повреждённый APK-файл"
                            compatibility is ApkInstallCompatibility.PackageMismatch ->
                                "Неверный пакет APK"
                            compatibility is ApkInstallCompatibility.SignatureMismatch ->
                                "Требуется переустановка (${updateState.info.tagName})"
                            compatibility is ApkInstallCompatibility.VersionDowngrade ->
                                "Версия APK ниже установленной"
                            else ->
                                "Обновление ${updateState.info.tagName} готово"
                        }
                    )
                },
                text = {
                    Text(
                        text = when {
                            savedMismatchApkName != null -> {
                                val backupNote = uiState.lastAutoBackupLocation?.let {
                                    "\n\nРезервная копия всех данных сохранена в «$it». После установки откройте Настройки → Импорт JSON и выберите этот файл."
                                } ?: ""
                                "APK «$savedMismatchApkName» сохранён в папку «Загрузки».\n\n1. Нажмите «Удалить текущую» и подтвердите удаление старой версии.\n2. Откройте «$savedMismatchApkName» в «Загрузках» и установите.\n\nПосле перехода на общий ключ будущие обновления из GitHub будут ставиться поверх без удаления.$backupNote"
                            }
                            compatibility is ApkInstallCompatibility.InvalidArchive ->
                                "Загруженный APK-файл повреждён или скачался не полностью. Закройте окно и запустите проверку обновлений заново."
                            compatibility is ApkInstallCompatibility.PackageMismatch ->
                                "Пакет внутри APK (${compatibility.archivePackage}) не совпадает с Sonora (${compatibility.expectedPackage}). Установка отменена."
                            compatibility is ApkInstallCompatibility.SignatureMismatch -> {
                                val keyDetails = if (compatibility.installedCertFingerprint.isNotBlank() &&
                                    compatibility.archiveCertFingerprint.isNotBlank()
                                ) {
                                    "\n\nКлюч установленной: ${compatibility.installedCertFingerprint}\nКлюч нового APK: ${compatibility.archiveCertFingerprint}"
                                } else {
                                    ""
                                }
                                val backupPath = uiState.lastAutoBackupLocation ?: "Downloads/Sonora/sonora_auto_backup.json"
                                "Установленная версия и новый APK подписаны разными ключами (например, сборка из AI Studio или старый ключ), поэтому Android блокирует установку поверх.\n\nДанные уже сохранены в «$backupPath». Сохраните APK в «Загрузки», переустановите 1 раз и восстановите данные через «Импорт JSON».$keyDetails"
                            }
                            compatibility is ApkInstallCompatibility.VersionDowngrade ->
                                "Код сборки в APK (${compatibility.archiveVersionCode}) ниже установленного (${compatibility.installedVersionCode}). Сохраните файл в «Загрузки» или переустановите приложение вручную."
                            else ->
                                "APK-файл загружен. Нажмите «Установить», чтобы запустить системный установщик. Все ваши данные сохранятся."
                        },
                        style = MaterialTheme.typography.bodyMedium
                    )
                },
                confirmButton = {
                    when {
                        savedMismatchApkName != null -> {
                            Button(
                                onClick = {
                                    runCatching {
                                        context.startActivity(ApkInstaller.createAppDetailsSettingsIntent(context))
                                    }.onFailure {
                                        onShowMessage("Откройте Настройки -> Приложения -> Sonora -> Удалить")
                                    }
                                    closeDialog()
                                },
                                shape = CircleShape,
                                modifier = Modifier.testTag("open_app_details_for_uninstall_button")
                            ) {
                                Text("Удалить текущую")
                            }
                        }

                        compatibility is ApkInstallCompatibility.InvalidArchive ||
                            compatibility is ApkInstallCompatibility.PackageMismatch -> {
                            Button(
                                onClick = {
                                    runCatching { updateState.apkFile.delete() }
                                    closeDialog()
                                },
                                shape = CircleShape,
                                modifier = Modifier.testTag("invalid_apk_close_button")
                            ) {
                                Text("Понятно")
                            }
                        }

                        compatibility is ApkInstallCompatibility.SignatureMismatch ||
                            compatibility is ApkInstallCompatibility.VersionDowngrade -> {
                            Button(
                                onClick = {
                                    scope.launch {
                                        viewModel.savePreUpdateBackupSnapshot()
                                        val displayName = updateState.info.assetName.ifBlank {
                                            "sonora-${updateState.info.tagName}.apk"
                                        }
                                        val result = withContext(Dispatchers.IO) {
                                            ApkInstaller.saveApkToDownloads(
                                                context = context,
                                                apkFile = updateState.apkFile,
                                                displayName = displayName
                                            )
                                        }
                                        result.onSuccess { savedName ->
                                            savedMismatchApkName = savedName
                                        }.onFailure { err ->
                                            onShowMessage(err.localizedMessage ?: "Не удалось сохранить APK")
                                        }
                                    }
                                },
                                shape = CircleShape,
                                modifier = Modifier.testTag("save_apk_downloads_button")
                            ) {
                                Text("В Загрузки")
                            }
                        }

                        else -> {
                            Button(
                                onClick = { triggerApkInstall(updateState.apkFile) },
                                shape = CircleShape,
                                modifier = Modifier.testTag("install_apk_button")
                            ) {
                                Text("Установить")
                            }
                        }
                    }
                },
                dismissButton = {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (savedMismatchApkName == null &&
                            (compatibility is ApkInstallCompatibility.SignatureMismatch ||
                                compatibility is ApkInstallCompatibility.VersionDowngrade)
                        ) {
                            TextButton(
                                onClick = {
                                    triggerApkInstall(
                                        file = updateState.apkFile,
                                        bypassCompatibilityCheck = true
                                    )
                                },
                                modifier = Modifier.testTag("force_install_apk_button")
                            ) {
                                Text("Установить всё равно")
                            }
                        }
                        TextButton(onClick = closeDialog) {
                            Text(if (savedMismatchApkName != null) "Готово" else "Закрыть")
                        }
                    }
                }
            )
        }

        else -> Unit
    }

    if (showEqualizerSheet) {
        ModalBottomSheet(
            onDismissRequest = { showEqualizerSheet = false },
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            EqualizerSheetContent(
                state = uiState.equalizerState,
                onToggleEnabled = viewModel::setEqualizerEnabled,
                onSelectPreset = viewModel::selectEqualizerPreset,
                onBassBoostChange = viewModel::setBassBoostStrength,
                onVirtualizerChange = viewModel::setVirtualizerEnabled,
                onBandChange = viewModel::setEqualizerBand,
                onReset = {
                    viewModel.resetEqualizer()
                    onShowMessage("Эквалайзер сброшен")
                }
            )
        }
    }

    if (showAudioQualitySheet) {
        ModalBottomSheet(
            onDismissRequest = { showAudioQualitySheet = false },
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
                    text = "Качество звука",
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onBackground
                )
                SonoraCard(modifier = Modifier.fillMaxWidth()) {
                    AudioQuality.entries.forEachIndexed { index, quality ->
                        val selected = uiState.settings.audioQuality == quality
                        val title = when (quality) {
                            AudioQuality.HIGH -> "Высокое (максимальный поток)"
                            AudioQuality.BALANCED -> "Сбалансированное"
                            AudioQuality.DATA_SAVER -> "Экономия трафика"
                        }
                        val subtitle = when (quality) {
                            AudioQuality.HIGH -> "Максимальный битрейт • до 320 кбит/с"
                            AudioQuality.BALANCED -> "Оптимальный баланс • ~128 кбит/с"
                            AudioQuality.DATA_SAVER -> "Минимальный расход трафика • ~64 кбит/с"
                        }
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.setAudioQuality(quality)
                                    showAudioQualitySheet = false
                                }
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = selected,
                                onClick = {
                                    viewModel.setAudioQuality(quality)
                                    showAudioQualitySheet = false
                                },
                                colors = RadioButtonDefaults.colors(
                                    selectedColor = MaterialTheme.colorScheme.primary,
                                    unselectedColor = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = title,
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                                    color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface
                                )
                                Text(
                                    text = subtitle,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            if (selected) {
                                Icon(
                                    imageVector = Icons.Rounded.Check,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                        if (index < AudioQuality.entries.lastIndex) {
                            SonoraSettingsDivider()
                        }
                    }
                }
            }
        }
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
                    } ?: "Плавное затухание громкости перед паузой.",
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
                        title = "Экспортировать файл JSON",
                        subtitle = "Выбрать папку и имя архива вручную",
                        valueText = "Экспорт",
                        icon = SonoraIcons.FileUpload,
                        iconTint = MaterialTheme.colorScheme.primary,
                        onClick = {
                            showBackupSheet = false
                            exportLauncher.launch("sonora_library_backup.json")
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
    val cacheMbLabel = String.format(Locale.US, "%.1f МБ", uiState.cacheSizeBytes / (1024f * 1024f))
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
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        item {
            Text(
                text = "Настройки",
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onBackground
            )
        }

        // АККАУНТ (unified compact card matching Image 2)
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
                            else -> "Синхронизация с серверами Google"
                        },
                        valueText = when {
                            isSyncing -> "Синхр..."
                            lastSyncShort != null -> lastSyncShort
                            activeAccount != null -> "Обновить"
                            else -> "Открыть"
                        },
                        icon = SonoraIcons.CloudDownload,
                        iconTint = if (isSyncing) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
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
                                .padding(horizontal = 14.dp, vertical = 6.dp),
                            color = MaterialTheme.colorScheme.primary,
                            trackColor = MaterialTheme.colorScheme.surfaceContainerHighest
                        )
                    }
                }
            }
        }

        // СИНХРОНИЗАЦИЯ И АУДИО (matching Image 2 middle section)
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SonoraSectionTitle(title = "СИНХРОНИЗАЦИЯ И АУДИО")
                SonoraCard(modifier = Modifier.fillMaxWidth()) {
                    SonoraSettingsActionRow(
                        title = "Качество кэша",
                        subtitle = "Максимальное качество для офлайн-режима",
                        valueText = qualityShortLabel,
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
                }
            }
        }

        // ПРОФИЛЬ И ВЕРСИЯ (matching Image 2 bottom section)
        item {
            val isCheckingUpdate = uiState.updateState is AppUpdateUiState.Checking
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SonoraSectionTitle(title = "ПРОФИЛЬ")
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
                        valueText = "Экспорт",
                        icon = SonoraIcons.FileUpload,
                        onClick = { showBackupSheet = true },
                        modifier = Modifier.testTag("open_backup_sheet_button")
                    )
                    SonoraSettingsDivider()
                    SonoraSettingsActionRow(
                        title = "Версия приложения",
                        subtitle = if (isCheckingUpdate) {
                            "Проверка обновлений Sonora..."
                        } else {
                            "Проверка обновлений Sonora"
                        },
                        valueText = "v${BuildConfig.VERSION_NAME}",
                        icon = Icons.Rounded.Refresh,
                        onClick = onOpenAppUpdate,
                        modifier = Modifier.testTag("open_app_update_button")
                    )
                }
            }
        }

        // ВОСПРОИЗВЕДЕНИЕ И ПАМЯТЬ (compact extra controls)
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SonoraSectionTitle(title = "ВОСПРОИЗВЕДЕНИЕ И ПАМЯТЬ")
                SonoraCard(modifier = Modifier.fillMaxWidth()) {
                    SonoraSettingsSwitchRow(
                        title = "Пропуск тишины",
                        subtitle = "Сокращать тихие паузы в треках и подкастах",
                        icon = SonoraIcons.Speed,
                        checked = uiState.settings.skipSilenceEnabled,
                        onCheckedChange = viewModel::setSkipSilenceEnabled,
                        testTag = "toggle_skip_silence"
                    )
                    SonoraSettingsDivider()
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
                        title = "Очистить кэш аудио",
                        subtitle = "Освободить кэш быстрого повтора",
                        valueText = cacheMbLabel,
                        icon = SonoraIcons.CleaningServices,
                        onClick = {
                            viewModel.clearCache { onShowMessage("Кэш аудио очищен") }
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
