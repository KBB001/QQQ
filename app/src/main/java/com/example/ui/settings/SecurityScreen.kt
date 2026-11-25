package com.example.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.BuildConfig
import com.example.core.common.ApkInstaller
import com.example.ui.components.SonoraCard
import com.example.ui.components.SonoraIcons
import com.example.ui.components.SonoraSectionTitle
import com.example.ui.components.SonoraSettingsActionRow
import com.example.ui.components.SonoraSettingsDivider
import com.example.ui.components.SonoraSettingsSwitchRow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecurityScreen(
    onBack: () -> Unit,
    onOpenAppUpdate: () -> Unit,
    onShowMessage: (String) -> Unit,
    viewModel: SecurityViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var showWipeDialog by remember { mutableStateOf(false) }

    val signatureFingerprint = remember(context) {
        ApkInstaller.getInstalledSignatureFingerprint(context)
    }

    val lastUpdateCheckLabel = remember(uiState.settings.lastUpdateCheckAtMs) {
        val ts = uiState.settings.lastUpdateCheckAtMs
        if (ts > 0L) {
            SimpleDateFormat("d MMM, HH:mm", Locale.forLanguageTag("ru")).format(Date(ts))
        } else {
            "Ещё не проверялось"
        }
    }

    if (showWipeDialog) {
        AlertDialog(
            onDismissRequest = { showWipeDialog = false },
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            title = { Text("Очистить личные данные и сессии?") },
            text = {
                Text(
                    text = "Будут удалены токены YouTube Music, cookies браузера, история прослушивания и поиска, очередь воспроизведения и временный потоковый кэш. Скачанные офлайн-треки и плейлисты останутся.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showWipeDialog = false
                        viewModel.wipeSensitiveData(onShowMessage)
                    },
                    shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = Color.White
                    ),
                    modifier = Modifier.testTag("confirm_security_wipe_button")
                ) {
                    Text("Очистить", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showWipeDialog = false }) {
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
        TopAppBar(
            windowInsets = WindowInsets(0, 0, 0, 0),
            title = {
                Text(
                    text = "Безопасность и защита",
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
                        .testTag("security_screen_back_button")
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Rounded.ArrowBack,
                        contentDescription = "Назад",
                        tint = MaterialTheme.colorScheme.onBackground
                    )
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(
                containerColor = MaterialTheme.colorScheme.background
            )
        )

        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
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
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.16f)),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = SonoraIcons.Shield,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "Защита данных активна",
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Text(
                                    text = "TLS 1.2+ • Локальное шифрование • Проверка подписи",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary
                                )
                            }
                        }

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            SecurityStatusPill(
                                label = if (uiState.databaseEncrypted) "База AES-256" else "База защищена",
                                active = uiState.databaseEncrypted,
                                modifier = Modifier.weight(1f)
                            )
                            SecurityStatusPill(
                                label = if (uiState.keystoreBacked) "Keystore активен" else "Ключ изолирован",
                                active = uiState.keystoreBacked,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SonoraSectionTitle(title = "ШИФРОВАНИЕ И ПРИВАТНОСТЬ")
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        SonoraSettingsActionRow(
                            title = "База медиатеки и сессии",
                            subtitle = if (uiState.keystoreBacked) {
                                "Ключи защищены в Android Keystore"
                            } else {
                                "Локальное шифрование AES-256-GCM"
                            },
                            valueText = if (uiState.databaseEncrypted) "SQLCipher" else "AES-256",
                            icon = SonoraIcons.Lock,
                            iconTint = MaterialTheme.colorScheme.primary,
                            onClick = {
                                onShowMessage("Медиатека, аккаунт и очередь зашифрованы на устройстве")
                            }
                        )
                        SonoraSettingsDivider()
                        SonoraSettingsSwitchRow(
                            title = "Шифровать резервные копии",
                            subtitle = "Защищать экспортируемые файлы паролем (AES-256)",
                            icon = SonoraIcons.Key,
                            checked = uiState.settings.encryptBackupsEnabled,
                            onCheckedChange = viewModel::setEncryptBackupsEnabled,
                            testTag = "toggle_encrypt_backups"
                        )
                        SonoraSettingsDivider()
                        SonoraSettingsSwitchRow(
                            title = "Защита экрана от снимков",
                            subtitle = "Блокировать скриншоты и скрывать превью в списке задач",
                            icon = SonoraIcons.VisibilityOff,
                            checked = uiState.settings.screenSecurityEnabled,
                            onCheckedChange = viewModel::setScreenSecurityEnabled,
                            testTag = "toggle_screen_security"
                        )
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SonoraSectionTitle(title = "СЕТЕВАЯ БЕЗОПАСНОСТЬ")
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        SonoraSettingsActionRow(
                            title = "Строгий протокол HTTPS",
                            subtitle = "Разрешён только TLS 1.2 / 1.3; открытый HTTP и небезопасные редиректы заблокированы",
                            valueText = "TLS 1.2+",
                            icon = SonoraIcons.Shield,
                            iconTint = MaterialTheme.colorScheme.primary,
                            onClick = {
                                onShowMessage("Все сетевые соединения работают исключительно по HTTPS (TLS 1.2+)")
                            }
                        )
                        SonoraSettingsDivider()
                        SonoraSettingsActionRow(
                            title = "Заблокировано HTTP-попыток",
                            subtitle = uiState.lastBlockedHost?.let { host ->
                                "Последний заблокированный хост: $host"
                            } ?: "Незащищённых переходов за сессию не зафиксировано",
                            valueText = uiState.blockedInsecureCount.toString(),
                            icon = SonoraIcons.WifiOff,
                            iconTint = if (uiState.blockedInsecureCount > 0) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                            onClick = {}
                        )
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SonoraSectionTitle(title = "ОБНОВЛЕНИЯ И ЦЕЛОСТНОСТЬ")
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        SonoraSettingsSwitchRow(
                            title = "Автопроверка обновлений",
                            subtitle = "Проверять новые версии каждые 24 часа и сверять SHA-256",
                            icon = Icons.Rounded.Refresh,
                            checked = uiState.settings.autoCheckUpdatesEnabled,
                            onCheckedChange = viewModel::setAutoCheckUpdatesEnabled,
                            testTag = "toggle_auto_check_updates"
                        )
                        SonoraSettingsDivider()
                        SonoraSettingsActionRow(
                            title = "Подпись APK и версия",
                            subtitle = "Последняя проверка: $lastUpdateCheckLabel",
                            valueText = signatureFingerprint ?: "v${BuildConfig.VERSION_NAME}",
                            icon = SonoraIcons.Key,
                            onClick = onOpenAppUpdate
                        )
                        SonoraSettingsDivider()
                        SonoraSettingsActionRow(
                            title = if (uiState.isCheckingUpdates) "Проверка релизов..." else "Проверить обновления сейчас",
                            subtitle = "Перейти к установке обновлений безопасности",
                            valueText = if (uiState.isCheckingUpdates) "..." else "Проверить",
                            icon = Icons.Rounded.Refresh,
                            iconTint = MaterialTheme.colorScheme.primary,
                            onClick = {
                                viewModel.checkForUpdatesNow(
                                    onUpToDateOrError = onShowMessage,
                                    onUpdateAvailable = { version ->
                                        onShowMessage("Доступно обновление $version")
                                        onOpenAppUpdate()
                                    }
                                )
                            },
                            modifier = Modifier.testTag("security_check_updates_button")
                        )
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SonoraSectionTitle(title = "УПРАВЛЕНИЕ ДАННЫМИ")
                    SonoraCard(modifier = Modifier.fillMaxWidth()) {
                        SonoraSettingsActionRow(
                            title = if (uiState.isWipingData) "Очистка данных..." else "Очистить личные данные и сессии",
                            subtitle = "Удалить аккаунт YouTube, cookies, историю и очередь",
                            valueText = "Сброс",
                            icon = SonoraIcons.DeleteOutline,
                            iconTint = MaterialTheme.colorScheme.error,
                            onClick = {
                                if (!uiState.isWipingData) {
                                    showWipeDialog = true
                                }
                            },
                            modifier = Modifier.testTag("security_wipe_data_button")
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SecurityStatusPill(
    label: String,
    active: Boolean,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(10.dp),
        color = if (active) {
            MaterialTheme.colorScheme.primary.copy(alpha = 0.14f)
        } else {
            MaterialTheme.colorScheme.surfaceContainerHighest
        }
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
            color = if (active) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 7.dp)
        )
    }
}
