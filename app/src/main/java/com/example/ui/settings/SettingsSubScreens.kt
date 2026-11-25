package com.example.ui.settings

import android.content.Context
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.minimumInteractiveComponentSize
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
import com.example.BuildConfig
import com.example.R
import com.example.core.common.ApkInstallCompatibility
import com.example.core.common.ApkInstaller
import com.example.core.common.DurationFormatter
import com.example.domain.model.AccountSyncState
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
import java.text.DateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SonoraSubScreenTopBar(
    title: String,
    onBack: () -> Unit,
    backTestTag: String,
    actions: @Composable () -> Unit = {}
) {
    TopAppBar(
        windowInsets = WindowInsets(0, 0, 0, 0),
        title = {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        },
        navigationIcon = {
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .minimumInteractiveComponentSize()
                    .testTag(backTestTag)
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                    contentDescription = "Назад",
                    tint = MaterialTheme.colorScheme.onBackground
                )
            }
        },
        actions = { actions() },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.background
        )
    )
}

@Composable
fun AppUpdateScreen(
    onBack: () -> Unit,
    onShowMessage: (String) -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pendingInstallFile by remember { mutableStateOf<File?>(null) }
    var savedMismatchApkName by remember { mutableStateOf<String?>(null) }

    val signatureFingerprint = remember(context) {
        ApkInstaller.getInstalledSignatureFingerprint(context)
    }

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
            onShowMessage("Разрешите установку из этого источника, чтобы обновить Sonora")
        }
    }

    fun triggerInstall(file: File, bypassCompatibility: Boolean = false) {
        if (!bypassCompatibility) {
            when (val check = ApkInstaller.checkInstallCompatibility(context, file)) {
                is ApkInstallCompatibility.InvalidArchive -> {
                    onShowMessage("APK-файл повреждён. Повторите загрузку.")
                    return
                }
                is ApkInstallCompatibility.PackageMismatch -> {
                    onShowMessage("Скачанный APK относится к другому пакету (${check.archivePackage}).")
                    return
                }
                is ApkInstallCompatibility.SignatureMismatch,
                is ApkInstallCompatibility.VersionDowngrade -> {
                    onShowMessage("Требуется сохранение APK в «Загрузки» для переустановки.")
                    return
                }
                ApkInstallCompatibility.Compatible -> Unit
            }
        }
        if (ApkInstaller.canRequestPackageInstalls(context)) {
            ApkInstaller.launchApkInstaller(context, file).onFailure { err ->
                onShowMessage("Не удалось открыть установщик: ${err.localizedMessage}")
            }
        } else {
            pendingInstallFile = file
            onShowMessage("Разрешите установку из неизвестных источников для Sonora")
            installPermissionLauncher.launch(ApkInstaller.createUnknownSourcesSettingsIntent(context))
        }
    }

    val updateState = uiState.updateState
    val isChecking = updateState is AppUpdateUiState.Checking
    val isDownloading = updateState is AppUpdateUiState.Downloading

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .navigationBarsPadding()
    ) {
        SonoraSubScreenTopBar(
            title = "Обновление",
            onBack = onBack,
            backTestTag = "update_screen_back_button"
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val headlineVersion = when (updateState) {
                        is AppUpdateUiState.Available -> updateState.info.tagName
                        is AppUpdateUiState.Downloading -> updateState.info.tagName
                        is AppUpdateUiState.ReadyToInstall -> updateState.info.tagName
                        else -> "v${BuildConfig.VERSION_NAME}"
                    }
                    val statusSubtitle = when (updateState) {
                        AppUpdateUiState.Idle -> "Текущая сборка ${BuildConfig.VERSION_CODE} • Автобэкап перед установкой"
                        AppUpdateUiState.Checking -> "Проверка новых релизов на GitHub..."
                        is AppUpdateUiState.Available -> "Доступно обновление приложения Sonora (у вас v${BuildConfig.VERSION_NAME})"
                        is AppUpdateUiState.Downloading -> "Загрузка пакета обновления..."
                        is AppUpdateUiState.ReadyToInstall -> "Пакет ${updateState.info.tagName} готов к установке"
                    }

                    Text(
                        text = headlineVersion,
                        style = MaterialTheme.typography.headlineLarge.copy(fontWeight = FontWeight.ExtraBold),
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        text = statusSubtitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (updateState is AppUpdateUiState.Available || updateState is AppUpdateUiState.ReadyToInstall) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )

                    val metaParts = buildList {
                        if (!BuildConfig.GITHUB_REPOSITORY.startsWith("YOUR_GITHUB_OWNER")) {
                            add(BuildConfig.GITHUB_REPOSITORY)
                        }
                        if (!signatureFingerprint.isNullOrBlank()) {
                            add("Ключ: $signatureFingerprint")
                        }
                    }
                    if (metaParts.isNotEmpty()) {
                        Text(
                            text = metaParts.joinToString(" • "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            item {
                when (updateState) {
                    is AppUpdateUiState.Downloading -> {
                        SonoraCard(modifier = Modifier.fillMaxWidth()) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
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
                                        text = String.format(Locale.US, "%d%% (%.1f / %.1f МБ)", pct, downloadedMb, totalMb),
                                        style = MaterialTheme.typography.labelLarge,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                } else {
                                    LinearProgressIndicator(
                                        modifier = Modifier.fillMaxWidth(),
                                        color = MaterialTheme.colorScheme.primary,
                                        trackColor = MaterialTheme.colorScheme.surfaceContainerHighest
                                    )
                                }
                                OutlinedButton(
                                    onClick = viewModel::dismissUpdateDialog,
                                    shape = CircleShape,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("Отменить загрузку")
                                }
                            }
                        }
                    }

                    is AppUpdateUiState.ReadyToInstall -> {
                        val compatibility = remember(updateState.apkFile) {
                            ApkInstaller.checkInstallCompatibility(context, updateState.apkFile)
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (savedMismatchApkName != null) {
                                SonoraCard(modifier = Modifier.fillMaxWidth()) {
                                    Text(
                                        text = "APK «$savedMismatchApkName» сохранён в Загрузки. Удалите текущую сборку и установите новый файл, затем восстановите резервную копию из Downloads/Sonora.",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.padding(14.dp)
                                    )
                                }
                                Button(
                                    onClick = {
                                        runCatching {
                                            context.startActivity(ApkInstaller.createAppDetailsSettingsIntent(context))
                                        }.onFailure {
                                            onShowMessage("Откройте Настройки → Приложения → Sonora → Удалить")
                                        }
                                    },
                                    shape = CircleShape,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(50.dp)
                                        .testTag("update_uninstall_old_button")
                                ) {
                                    Text("Удалить текущую версию", fontWeight = FontWeight.Bold)
                                }
                            } else if (compatibility is ApkInstallCompatibility.SignatureMismatch ||
                                compatibility is ApkInstallCompatibility.VersionDowngrade
                            ) {
                                Button(
                                    onClick = {
                                        scope.launch {
                                            viewModel.savePreUpdateBackupSnapshot()
                                            val displayName = updateState.info.assetName.ifBlank {
                                                "sonora-${updateState.info.tagName}.apk"
                                            }
                                            val res = withContext(Dispatchers.IO) {
                                                ApkInstaller.saveApkToDownloads(
                                                    context = context,
                                                    apkFile = updateState.apkFile,
                                                    displayName = displayName
                                                )
                                            }
                                            res.onSuccess { savedMismatchApkName = it }
                                                .onFailure { onShowMessage(it.localizedMessage ?: "Ошибка сохранения") }
                                        }
                                    },
                                    shape = CircleShape,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(50.dp)
                                        .testTag("update_save_downloads_button")
                                ) {
                                    Text("Сохранить APK в Загрузки", fontWeight = FontWeight.Bold)
                                }
                            } else {
                                Button(
                                    onClick = { triggerInstall(updateState.apkFile) },
                                    shape = CircleShape,
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = MaterialTheme.colorScheme.primary,
                                        contentColor = MaterialTheme.colorScheme.onPrimary
                                    ),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(50.dp)
                                        .testTag("update_install_apk_button")
                                ) {
                                    Text("Установить обновление", fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }

                    is AppUpdateUiState.Available -> {
                        Button(
                            onClick = {
                                savedMismatchApkName = null
                                viewModel.startUpdateDownload(
                                    info = updateState.info,
                                    onReadyToInstall = { downloadedFile ->
                                        if (ApkInstaller.checkInstallCompatibility(context, downloadedFile)
                                            is ApkInstallCompatibility.Compatible
                                        ) {
                                            triggerInstall(downloadedFile)
                                        }
                                    },
                                    onError = onShowMessage
                                )
                            },
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(50.dp)
                                .testTag("update_download_install_button")
                        ) {
                            Text("Установить обновление", fontWeight = FontWeight.Bold)
                        }
                    }

                    else -> {
                        Button(
                            onClick = { viewModel.checkForUpdates(onShowMessage) },
                            enabled = !isChecking && !isDownloading,
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(50.dp)
                                .testTag("update_screen_check_button")
                        ) {
                            if (isChecking) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.onPrimary
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Проверка...", fontWeight = FontWeight.Bold)
                            } else {
                                Icon(Icons.Rounded.Refresh, contentDescription = null)
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Проверить обновление", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }

            item {
                val notesItems = remember(updateState) {
                    val rawNotes = when (updateState) {
                        is AppUpdateUiState.Available -> updateState.info.releaseNotes
                        is AppUpdateUiState.Downloading -> updateState.info.releaseNotes
                        is AppUpdateUiState.ReadyToInstall -> updateState.info.releaseNotes
                        else -> ""
                    }
                    if (rawNotes.isNotBlank()) {
                        rawNotes.lines()
                            .map { it.trim().trimStart('-', '*', '•').trim() }
                            .filter { it.isNotBlank() }
                            .take(6)
                            .mapIndexed { idx, line -> "Изменение ${idx + 1}" to line }
                    } else {
                        listOf(
                            "Аудио движок" to "5-полосный эквалайзер с усилением баса и Spatial Audio",
                            "Офлайн-режим" to "Автоматическая загрузка избранного по Wi-Fi и кэш треков",
                            "Синхронизация" to "Двусторонняя интеграция с аккаунтом YouTube Music и JSON-бэкапом"
                        )
                    }
                }

                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SonoraSectionTitle(title = "ЧТО НОВОГО В ВЕРСИИ")
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        notesItems.forEachIndexed { index, (label, detail) ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 14.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                                verticalAlignment = Alignment.Top
                            ) {
                                Text(
                                    text = label,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.width(96.dp)
                                )
                                Text(
                                    text = detail,
                                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                                    color = MaterialTheme.colorScheme.onSurface,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                            if (index < notesItems.lastIndex) {
                                SonoraSettingsDivider()
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun EqualizerScreen(
    onBack: () -> Unit,
    onShowMessage: (String) -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val eq = uiState.equalizerState
    var showPresetSheet by remember { mutableStateOf(false) }

    if (showPresetSheet) {
        ModalBottomSheet(
            onDismissRequest = { showPresetSheet = false },
            containerColor = MaterialTheme.colorScheme.surface
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
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
                        text = "Пресеты эквалайзера",
                        style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold)
                    )
                    TextButton(
                        onClick = {
                            viewModel.resetEqualizer()
                            showPresetSheet = false
                            onShowMessage("Параметры эквалайзера сброшены")
                        }
                    ) {
                        Text("Сбросить")
                    }
                }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    eq.presetNames.forEachIndexed { index, name ->
                        SonoraFilterPill(
                            label = name,
                            selected = !eq.customBandsApplied && index == eq.selectedPresetIndex,
                            onClick = {
                                viewModel.selectEqualizerPreset(index)
                                showPresetSheet = false
                            }
                        )
                    }
                }
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .navigationBarsPadding()
    ) {
        SonoraSubScreenTopBar(
            title = "Эквалайзер",
            onBack = onBack,
            backTestTag = "equalizer_screen_back_button",
            actions = {
                TextButton(
                    onClick = {
                        viewModel.resetEqualizer()
                        onShowMessage("Эквалайзер сброшен")
                    },
                    modifier = Modifier.testTag("equalizer_reset_button")
                ) {
                    Text("Сброс", color = MaterialTheme.colorScheme.primary)
                }
            }
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp)
        ) {
            item {
                EqualizerControlsCardAndSliders(
                    state = eq,
                    onToggleEnabled = viewModel::setEqualizerEnabled,
                    onOpenPresets = { showPresetSheet = true },
                    onSelectPreset = viewModel::selectEqualizerPreset,
                    onBassBoostChange = viewModel::setBassBoostStrength,
                    onVirtualizerChange = viewModel::setVirtualizerEnabled,
                    onBandChange = viewModel::setEqualizerBand
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EqualizerControlsCardAndSliders(
    state: EqualizerState,
    onToggleEnabled: (Boolean) -> Unit,
    onOpenPresets: (() -> Unit)? = null,
    onSelectPreset: (Int) -> Unit,
    onBassBoostChange: (Int) -> Unit,
    onVirtualizerChange: (Boolean) -> Unit,
    onBandChange: (Int, Short) -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        SonoraCard(modifier = Modifier.fillMaxWidth()) {
            SonoraSettingsSwitchRow(
                title = "Аудиообработка",
                subtitle = if (state.isAvailable) {
                    if (state.isEnabled) "Подключено к текущему аудиопотоку" else "Включите для обработки звука"
                } else {
                    "Настройки сохранятся и применятся при запуске трека"
                },
                icon = SonoraIcons.Equalizer,
                checked = state.isEnabled,
                onCheckedChange = onToggleEnabled,
                testTag = "equalizer_master_switch"
            )

            SonoraSettingsDivider()

            SonoraSettingsActionRow(
                title = "Пресет эквалайзера",
                subtitle = "Готовые кривые частотных полос",
                valueText = state.activePresetLabel,
                icon = SonoraIcons.GraphicEq,
                iconTint = if (state.isEnabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                onClick = {
                    if (onOpenPresets != null) {
                        onOpenPresets()
                    } else if (state.presetNames.isNotEmpty()) {
                        val nextIdx = (state.selectedPresetIndex + 1) % state.presetNames.size
                        onSelectPreset(nextIdx)
                    }
                },
                modifier = Modifier.testTag("equalizer_preset_row")
            )

            SonoraSettingsDivider()

            val bassDb = (state.bassBoostStrength / 1000f) * 15f
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Усиление баса",
                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "Аппаратное насыщение низких частот",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    Text(
                        text = if (state.bassBoostStrength == 0) {
                            "0.0 дБ"
                        } else {
                            String.format(Locale.US, "+%.1f дБ", bassDb)
                        },
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                        color = if (state.isEnabled && state.bassBoostStrength > 0) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                }
                Slider(
                    value = state.bassBoostStrength.toFloat(),
                    onValueChange = { onBassBoostChange(it.toInt()) },
                    valueRange = 0f..1000f,
                    enabled = state.isEnabled && state.bassBoostSupported,
                    colors = SliderDefaults.colors(
                        thumbColor = MaterialTheme.colorScheme.onBackground,
                        activeTrackColor = MaterialTheme.colorScheme.primary,
                        inactiveTrackColor = MaterialTheme.colorScheme.surfaceContainerHighest
                    ),
                    modifier = Modifier.testTag("equalizer_bass_boost_slider")
                )
            }

            SonoraSettingsDivider()

            SonoraSettingsSwitchRow(
                title = "Объёмный звук",
                subtitle = if (state.virtualizerSupported) {
                    "Пространственное аудио для наушников"
                } else {
                    "Эффект не поддерживается аудиовыходом устройства"
                },
                icon = SonoraIcons.Headphones,
                checked = state.virtualizerEnabled,
                onCheckedChange = onVirtualizerChange,
                enabled = state.isEnabled && state.virtualizerSupported,
                testTag = "equalizer_virtualizer_switch"
            )
        }

        if (state.presetNames.isNotEmpty()) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                state.presetNames.forEachIndexed { index, name ->
                    SonoraFilterPill(
                        label = name,
                        selected = !state.customBandsApplied && index == state.selectedPresetIndex,
                        onClick = { onSelectPreset(index) },
                        modifier = Modifier.testTag("equalizer_preset_pill_$index")
                    )
                }
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            state.bandLevels.forEachIndexed { index, levelMb ->
                val hz = state.bandFrequenciesHz.getOrElse(index) { 0 }
                val freqLabel = when {
                    hz >= 1000 && hz % 1000 == 0 -> "${hz / 1000} кГц"
                    hz >= 1000 -> String.format(Locale.US, "%.1f кГц", hz / 1000f)
                    else -> "$hz Гц"
                }
                val db = levelMb / 100f
                Column {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = freqLabel,
                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                            color = MaterialTheme.colorScheme.onBackground
                        )
                        Text(
                            text = String.format(Locale.US, "%+.1f дБ", db),
                            style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold),
                            color = if (state.isEnabled) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            }
                        )
                    }
                    Slider(
                        value = levelMb.toFloat(),
                        onValueChange = { onBandChange(index, it.toInt().toShort()) },
                        valueRange = state.minLevelMb.toFloat()..state.maxLevelMb.toFloat(),
                        enabled = state.isEnabled,
                        colors = SliderDefaults.colors(
                            thumbColor = MaterialTheme.colorScheme.onBackground,
                            activeTrackColor = MaterialTheme.colorScheme.primary,
                            inactiveTrackColor = MaterialTheme.colorScheme.surfaceContainerHighest
                        ),
                        modifier = Modifier.testTag("equalizer_band_slider_$index")
                    )
                }
            }
        }
    }
}

@Composable
fun CacheQualityScreen(
    onBack: () -> Unit,
    onShowMessage: (String) -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var showClearDownloadsDialog by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.refreshCacheSize()
    }

    val totalBytes = uiState.totalStorageBytes
    val streamCacheLabel = DurationFormatter.formatBytes(uiState.cacheSizeBytes)
    val offlineBytesLabel = DurationFormatter.formatBytes(uiState.offlineDownloadsBytes)
    val totalStorageLabel = DurationFormatter.formatBytes(totalBytes)

    if (showClearDownloadsDialog) {
        AlertDialog(
            onDismissRequest = { showClearDownloadsDialog = false },
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            title = { Text("Удалить все офлайн-треки?") },
            text = {
                Text(
                    text = "Будет удалено ${DurationFormatter.formatTrackCount(uiState.offlineTracksCount)} ($offlineBytesLabel) с памяти устройства. Избранное и плейлисты сохранятся.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showClearDownloadsDialog = false
                        viewModel.clearOfflineDownloads { removed ->
                            onShowMessage("Удалено офлайн-треков: $removed")
                        }
                    },
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = Color.White
                    ),
                    modifier = Modifier.testTag("confirm_clear_offline_downloads_button")
                ) {
                    Text("Удалить", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearDownloadsDialog = false }) {
                    Text("Отмена")
                }
            }
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .navigationBarsPadding()
    ) {
        SonoraSubScreenTopBar(
            title = "Качество кэша и память",
            onBack = onBack,
            backTestTag = "cache_quality_back_button"
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SonoraSectionTitle(title = "ИСПОЛЬЗОВАНИЕ ПАМЯТИ")
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(36.dp)
                                            .clip(RoundedCornerShape(10.dp))
                                            .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Icon(
                                            imageVector = SonoraIcons.Storage,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.size(19.dp)
                                        )
                                    }
                                    Column {
                                        Text(
                                            text = "Занято Sonora",
                                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                                            color = MaterialTheme.colorScheme.onSurface
                                        )
                                        Text(
                                            text = if (uiState.offlineTracksCount > 0) {
                                                "${DurationFormatter.formatTrackCount(uiState.offlineTracksCount)} в офлайн-доступе"
                                            } else {
                                                "Офлайн-загрузок пока нет"
                                            },
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                                Text(
                                    text = totalStorageLabel,
                                    style = MaterialTheme.typography.titleMedium.copy(
                                        fontWeight = FontWeight.ExtraBold,
                                        fontFeatureSettings = "tnum"
                                    ),
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }

                            val denom = totalBytes.coerceAtLeast(1L).toFloat()
                            val offlineRatio = (uiState.offlineDownloadsBytes / denom).coerceIn(0f, 1f)
                            val streamRatio = (uiState.cacheSizeBytes / denom).coerceIn(0f, 1f)

                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(8.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                            ) {
                                if (offlineRatio > 0f) {
                                    Box(
                                        modifier = Modifier
                                            .weight(offlineRatio.coerceAtLeast(0.02f))
                                            .height(8.dp)
                                            .background(MaterialTheme.colorScheme.primary)
                                    )
                                }
                                if (streamRatio > 0f) {
                                    Box(
                                        modifier = Modifier
                                            .weight(streamRatio.coerceAtLeast(0.02f))
                                            .height(8.dp)
                                            .background(MaterialTheme.colorScheme.secondary)
                                    )
                                }
                                val remainingRatio = (1f - offlineRatio - streamRatio).coerceAtLeast(0f)
                                if (totalBytes == 0L || remainingRatio > 0.01f) {
                                    Spacer(modifier = Modifier.weight(remainingRatio.coerceAtLeast(1f)))
                                }
                            }

                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(8.dp)
                                            .clip(CircleShape)
                                            .background(MaterialTheme.colorScheme.primary)
                                    )
                                    Text(
                                        text = "Офлайн: $offlineBytesLabel",
                                        style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(8.dp)
                                            .clip(CircleShape)
                                            .background(MaterialTheme.colorScheme.secondary)
                                    )
                                    Text(
                                        text = "Потоковый кэш: $streamCacheLabel",
                                        style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = "tnum"),
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SonoraSectionTitle(title = "КАЧЕСТВО АУДИОПОТОКА И ОФЛАЙН-ФАЙЛОВ")
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        AudioQuality.entries.forEachIndexed { index, quality ->
                            val selected = uiState.settings.audioQuality == quality
                            val title = when (quality) {
                                AudioQuality.HIGH -> "Высокое (максимальный поток)"
                                AudioQuality.BALANCED -> "Сбалансированное"
                                AudioQuality.DATA_SAVER -> "Экономия трафика"
                            }
                            val subtitle = when (quality) {
                                AudioQuality.HIGH -> "Максимальный битрейт • до 320 kbps"
                                AudioQuality.BALANCED -> "Оптимальный баланс • ~128 kbps"
                                AudioQuality.DATA_SAVER -> "Минимальный расход трафика • ~64 kbps"
                            }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        viewModel.setAudioQuality(quality)
                                        onShowMessage("Качество: $title")
                                    }
                                    .padding(horizontal = 14.dp, vertical = 12.dp)
                                    .testTag("quality_option_${quality.name}"),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                RadioButton(
                                    selected = selected,
                                    onClick = {
                                        viewModel.setAudioQuality(quality)
                                        onShowMessage("Качество: $title")
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

            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SonoraSectionTitle(title = "УПРАВЛЕНИЕ КЭШЕМ И ЗАГРУЗКАМИ")
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        SonoraSettingsSwitchRow(
                            title = "Автоматическая загрузка избранного",
                            subtitle = "Скачивать треки из Избранного по Wi-Fi",
                            icon = SonoraIcons.DownloadForOffline,
                            checked = uiState.settings.autoDownloadFavoritesWifi,
                            onCheckedChange = { enabled ->
                                viewModel.setAutoDownloadFavoritesWifi(enabled)
                                onShowMessage(
                                    if (enabled) "Автозагрузка избранного по Wi-Fi включена"
                                    else "Автозагрузка избранного отключена"
                                )
                            },
                            testTag = "toggle_auto_download_favorites_wifi"
                        )
                        SonoraSettingsDivider()
                        SonoraSettingsActionRow(
                            title = "Очистить потоковый кэш",
                            subtitle = "Удалить временный буфер стриминга (до 256 МБ LRU)",
                            valueText = streamCacheLabel,
                            icon = SonoraIcons.CleaningServices,
                            onClick = {
                                viewModel.clearCache { onShowMessage("Потоковый кэш очищен") }
                            },
                            modifier = Modifier.testTag("cache_quality_clear_button")
                        )
                        SonoraSettingsDivider()
                        SonoraSettingsActionRow(
                            title = "Удалить все офлайн-треки",
                            subtitle = if (uiState.offlineTracksCount > 0) {
                                "Освободить память от ${DurationFormatter.formatTrackCount(uiState.offlineTracksCount)}"
                            } else {
                                "Нет сохранённых офлайн-треков"
                            },
                            valueText = offlineBytesLabel,
                            icon = SonoraIcons.DeleteOutline,
                            iconTint = if (uiState.offlineTracksCount > 0) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            onClick = {
                                if (uiState.offlineTracksCount > 0) {
                                    showClearDownloadsDialog = true
                                } else {
                                    onShowMessage("Нет скачанных треков для удаления")
                                }
                            },
                            modifier = Modifier.testTag("cache_quality_clear_downloads_button")
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun YouTubeAccountScreen(
    onBack: () -> Unit,
    onOpenLogin: (resetSession: Boolean) -> Unit,
    onOpenSignOutConfirm: () -> Unit,
    onShowMessage: (String) -> Unit,
    accountViewModel: YouTubeAccountViewModel = hiltViewModel()
) {
    val uiState by accountViewModel.uiState.collectAsStateWithLifecycle()
    val active = uiState.activeAccount
    val isSyncing = uiState.syncState is AccountSyncState.Syncing
    var showCookieDialog by remember { mutableStateOf(false) }

    if (showCookieDialog) {
        var cookieInput by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { if (!uiState.isSigningIn) showCookieDialog = false },
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            title = { Text("Вход через Cookie YouTube") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Вставьте Cookie с music.youtube.com (SAPISID и SID).",
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
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        accountViewModel.signInWithSession(
                            cookieHeader = cookieInput,
                            onSuccess = { acc ->
                                showCookieDialog = false
                                onShowMessage("Подключён аккаунт: ${acc.name}")
                            },
                            onError = onShowMessage
                        )
                    },
                    enabled = cookieInput.isNotBlank() && !uiState.isSigningIn,
                    shape = CircleShape
                ) {
                    Text("Подключить", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showCookieDialog = false }, enabled = !uiState.isSigningIn) {
                    Text("Отмена")
                }
            }
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .navigationBarsPadding()
    ) {
        SonoraSubScreenTopBar(
            title = "Аккаунт YouTube Music",
            onBack = onBack,
            backTestTag = "yt_account_screen_back_button"
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (active == null) {
                item {
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(14.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(76.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.14f))
                                    .border(2.dp, MaterialTheme.colorScheme.primary, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = SonoraIcons.AccountCircle,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(38.dp)
                                )
                            }
                            Text(
                                text = "Войдите в YouTube Music",
                                style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.ExtraBold),
                                textAlign = TextAlign.Center
                            )
                            Text(
                                text = "Импортируйте любимые треки, плейлисты и историю прослушиваний с автоматической двусторонней синхронизацией.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = TextAlign.Center
                            )
                            Button(
                                onClick = { onOpenLogin(false) },
                                shape = CircleShape,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.primary,
                                    contentColor = MaterialTheme.colorScheme.onPrimary
                                ),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(50.dp)
                                    .testTag("yt_account_signin_button")
                            ) {
                                Text("Войти в аккаунт YouTube", fontWeight = FontWeight.Bold)
                            }
                            OutlinedButton(
                                onClick = { showCookieDialog = true },
                                shape = CircleShape,
                                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(48.dp)
                                    .testTag("yt_account_cookie_signin_button")
                            ) {
                                Text("Войти через Cookie браузера")
                            }
                        }
                    }
                }
            } else {
                item {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(92.dp)
                                .clip(CircleShape)
                                .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f)),
                            contentAlignment = Alignment.Center
                        ) {
                            Surface(
                                modifier = Modifier
                                    .size(76.dp)
                                    .border(2.dp, MaterialTheme.colorScheme.primary, CircleShape),
                                shape = CircleShape,
                                color = MaterialTheme.colorScheme.surfaceContainerHigh
                            ) {
                                if (active.avatarUrl.isNotBlank()) {
                                    AsyncImage(
                                        model = active.avatarUrl,
                                        contentDescription = active.name,
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
                                            modifier = Modifier.size(38.dp)
                                        )
                                    }
                                }
                            }
                        }

                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(3.dp)
                        ) {
                            Text(
                                text = active.email.ifBlank { active.name },
                                style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.ExtraBold),
                                color = MaterialTheme.colorScheme.onBackground,
                                textAlign = TextAlign.Center,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(horizontal = 8.dp)
                            )
                            val secondaryLine = if (active.email.isNotBlank()) active.name else active.handle
                            if (secondaryLine.isNotBlank()) {
                                Text(
                                    text = secondaryLine,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            val syncText = remember(active.lastSyncTimestamp, uiState.isOnline) {
                                when {
                                    !uiState.isOnline -> "Офлайн • Ожидание сети"
                                    active.lastSyncTimestamp > 0L -> {
                                        val fmt = DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, Locale.getDefault())
                                        "Синхронизировано • ${fmt.format(Date(active.lastSyncTimestamp))}"
                                    }
                                    else -> "Готов к синхронизации"
                                }
                            }
                            Text(
                                text = syncText,
                                style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
                                color = if (uiState.isOnline) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                }
                            )
                        }

                        Button(
                            onClick = { accountViewModel.syncAndMergeActiveAccount(onShowMessage) },
                            enabled = !isSyncing,
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                                contentColor = MaterialTheme.colorScheme.onPrimary
                            ),
                            contentPadding = PaddingValues(horizontal = 32.dp, vertical = 12.dp),
                            modifier = Modifier
                                .height(48.dp)
                                .testTag("yt_account_sync_pill_button")
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
                                Icon(
                                    imageVector = SonoraIcons.Sync,
                                    contentDescription = null,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text("Синхронизировать", fontWeight = FontWeight.Bold)
                            }
                        }

                        when (val s = uiState.syncState) {
                            is AccountSyncState.Syncing -> {
                                SonoraCard(modifier = Modifier.fillMaxWidth()) {
                                    Column(
                                        modifier = Modifier.padding(14.dp),
                                        verticalArrangement = Arrangement.spacedBy(8.dp)
                                    ) {
                                        LinearProgressIndicator(
                                            progress = { s.progress.coerceIn(0.05f, 1f) },
                                            modifier = Modifier.fillMaxWidth(),
                                            color = MaterialTheme.colorScheme.primary,
                                            trackColor = MaterialTheme.colorScheme.surfaceContainerHighest
                                        )
                                        Text(
                                            text = s.stage,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.primary
                                        )
                                    }
                                }
                            }
                            is AccountSyncState.Completed -> {
                                SonoraCard(
                                    borderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.45f),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(horizontal = 14.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Text(
                                            text = "Импортировано: +${s.summary.importedLiked} избр., +${s.summary.importedPlaylists} пл., +${s.summary.importedHistory} ист.",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.primary,
                                            modifier = Modifier.weight(1f)
                                        )
                                        IconButton(
                                            onClick = accountViewModel::clearSyncState,
                                            modifier = Modifier.size(28.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Rounded.Close,
                                                contentDescription = "Скрыть",
                                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                                modifier = Modifier.size(16.dp)
                                            )
                                        }
                                    }
                                }
                            }
                            is AccountSyncState.Error -> {
                                SonoraCard(
                                    borderColor = MaterialTheme.colorScheme.error.copy(alpha = 0.5f),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(12.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                                    ) {
                                        Text(
                                            text = s.message,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.error,
                                            modifier = Modifier.weight(1f)
                                        )
                                        TextButton(
                                            onClick = { accountViewModel.syncAndMergeActiveAccount(onShowMessage) }
                                        ) {
                                            Text("Повторить")
                                        }
                                    }
                                }
                            }
                            else -> Unit
                        }
                    }
                }

                item {
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 14.dp),
                            horizontalArrangement = Arrangement.SpaceEvenly,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            AccountStatColumn(
                                value = uiState.favoriteCount.toString(),
                                label = "Избранное",
                                modifier = Modifier.weight(1f)
                            )
                            AccountStatColumn(
                                value = uiState.playlistCount.toString(),
                                label = "Плейлисты",
                                modifier = Modifier.weight(1f)
                            )
                            AccountStatColumn(
                                value = uiState.historyCount.toString(),
                                label = "История",
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }

                if (uiState.accounts.size > 1) {
                    item {
                        SonoraCard(modifier = Modifier.fillMaxWidth()) {
                            Column(
                                modifier = Modifier.padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Text(
                                    text = "Профили (${uiState.accounts.size})",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                FlowRow(
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    uiState.accounts.forEach { acc ->
                                        val selected = acc.id == active.id
                                        FilterChip(
                                            selected = selected,
                                            onClick = {
                                                if (!selected) accountViewModel.switchActiveAccount(acc.id, onShowMessage)
                                            },
                                            shape = CircleShape,
                                            label = { Text(acc.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                                            trailingIcon = if (!selected) {
                                                {
                                                    Icon(
                                                        imageVector = Icons.Rounded.Close,
                                                        contentDescription = "Удалить",
                                                        modifier = Modifier
                                                            .size(16.dp)
                                                            .clickable { accountViewModel.removeAccount(acc.id, onShowMessage) }
                                                    )
                                                }
                                            } else null,
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
                                OutlinedButton(
                                    onClick = { accountViewModel.unifyAllAccountsIntoActive(onShowMessage) },
                                    enabled = !isSyncing,
                                    shape = CircleShape,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Icon(SonoraIcons.MergeType, contentDescription = null)
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text("Объединить все аккаунты")
                                }
                            }
                        }
                    }
                }

                item {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        SonoraSectionTitle(title = "НАСТРОЙКИ СИНХРОНИЗАЦИИ")
                        SonoraCard(modifier = Modifier.fillMaxWidth()) {
                            SonoraSettingsSwitchRow(
                                title = "Автосинхронизация плейлистов",
                                subtitle = "Обновлять треки и лайки при каждом запуске",
                                icon = SonoraIcons.Sync,
                                checked = uiState.autoSyncEnabled,
                                onCheckedChange = accountViewModel::setAutoSyncEnabled,
                                testTag = "yt_account_autosync_switch"
                            )
                            SonoraSettingsDivider()
                            SonoraSettingsActionRow(
                                title = "Импорт из YouTube Music",
                                subtitle = "Перенести историю и сохранённые плейлисты",
                                valueText = if (isSyncing) "Идёт..." else "Обновить",
                                icon = SonoraIcons.CloudDownload,
                                onClick = {
                                    if (!isSyncing) accountViewModel.syncAndMergeActiveAccount(onShowMessage)
                                }
                            )
                            SonoraSettingsDivider()
                            SonoraSettingsActionRow(
                                title = "Добавить ещё аккаунт",
                                subtitle = "Войти во второй профиль через браузер",
                                icon = Icons.Rounded.Add,
                                onClick = { if (!isSyncing) onOpenLogin(true) }
                            )
                            SonoraSettingsDivider()
                            SonoraSettingsActionRow(
                                title = "Обновить сессию по Cookie",
                                subtitle = "Импортировать SAPISID/SID вручную",
                                icon = SonoraIcons.Key,
                                onClick = { if (!isSyncing) showCookieDialog = true }
                            )
                            SonoraSettingsDivider()
                            SonoraSettingsActionRow(
                                title = "Отвязать аккаунт",
                                subtitle = "Выйти из учётной записи и очистить кэш",
                                icon = SonoraIcons.Logout,
                                iconTint = MaterialTheme.colorScheme.error,
                                onClick = onOpenSignOutConfirm,
                                modifier = Modifier.testTag("yt_account_unlink_button")
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AccountStatColumn(
    value: String,
    label: String,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp)
    ) {
        Text(
            text = value,
            style = MaterialTheme.typography.titleLarge.copy(
                fontWeight = FontWeight.ExtraBold,
                fontFeatureSettings = "tnum"
            ),
            color = MaterialTheme.colorScheme.onBackground
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1
        )
    }
}

@Composable
fun YouTubeSignOutConfirmScreen(
    onBack: () -> Unit,
    onCompleted: (String) -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var unlinkAccount by remember { mutableStateOf(true) }
    var clearCache by remember { mutableStateOf(false) }
    var savePlaylistsJson by remember { mutableStateOf(true) }
    var isProcessing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.refreshCacheSize()
    }

    val manualJsonExportLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri != null) {
            scope.launch {
                runCatching {
                    val json = viewModel.generateBackupJson()
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri)?.use { out ->
                            out.write(json.toByteArray(Charsets.UTF_8))
                            out.flush()
                        } ?: error("Не удалось открыть файл")
                    }
                }.onSuccess {
                    onCompleted("Резервная копия JSON сохранена")
                }.onFailure { err ->
                    onCompleted("Ошибка экспорта: ${err.localizedMessage}")
                }
            }
        }
    }

    val cacheMb = String.format(Locale.US, "%.1f МБ", uiState.cacheSizeBytes / (1024f * 1024f))

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .navigationBarsPadding()
    ) {
        SonoraSubScreenTopBar(
            title = "Подтверждение выхода",
            onBack = onBack,
            backTestTag = "sign_out_confirm_back_button"
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            SonoraCard(modifier = Modifier.fillMaxWidth()) {
                SonoraSettingsSwitchRow(
                    title = "Отвязать аккаунт",
                    subtitle = "Сбросить подключение к YouTube Music",
                    icon = SonoraIcons.Logout,
                    checked = unlinkAccount,
                    onCheckedChange = { unlinkAccount = it },
                    iconTint = MaterialTheme.colorScheme.error,
                    testTag = "sign_out_option_unlink"
                )
                SonoraSettingsDivider()
                SonoraSettingsSwitchRow(
                    title = "Очистить локальный кэш",
                    subtitle = "Удалить загруженные потоки ($cacheMb)",
                    icon = SonoraIcons.CleaningServices,
                    checked = clearCache,
                    onCheckedChange = { clearCache = it },
                    testTag = "sign_out_option_clear_cache"
                )
                SonoraSettingsDivider()
                SonoraSettingsSwitchRow(
                    title = "Сохранить плейлисты в JSON",
                    subtitle = "Экспортировать медиатеку в Downloads/Sonora",
                    icon = SonoraIcons.FileUpload,
                    checked = savePlaylistsJson,
                    onCheckedChange = { savePlaylistsJson = it },
                    testTag = "sign_out_option_backup_json"
                )
                SonoraSettingsDivider()
                SonoraSettingsActionRow(
                    title = "Выбрать папку для JSON вручную",
                    subtitle = "Сохранить резервную копию в произвольное место",
                    valueText = "JSON",
                    icon = SonoraIcons.BookmarkAdd,
                    onClick = {
                        manualJsonExportLauncher.launch("sonora_library_backup.json")
                    },
                    modifier = Modifier.testTag("sign_out_manual_json_export")
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(
                    onClick = onBack,
                    enabled = !isProcessing,
                    shape = CircleShape,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    modifier = Modifier
                        .weight(1f)
                        .height(50.dp)
                        .testTag("sign_out_cancel_button")
                ) {
                    Text("Отмена", fontWeight = FontWeight.SemiBold)
                }

                Button(
                    onClick = {
                        if (isProcessing) return@Button
                        isProcessing = true
                        viewModel.executeSignOutWithOptions(
                            unlinkAccount = unlinkAccount,
                            clearCache = clearCache,
                            saveBackupToDownloads = savePlaylistsJson
                        ) { message ->
                            isProcessing = false
                            onCompleted(message)
                        }
                    },
                    enabled = !isProcessing && (unlinkAccount || clearCache || savePlaylistsJson),
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary
                    ),
                    modifier = Modifier
                        .weight(1f)
                        .height(50.dp)
                        .testTag("sign_out_confirm_button")
                ) {
                    if (isProcessing) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    } else {
                        Text("Подтвердить", fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
