package com.example.domain.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

@Serializable
enum class AudioQuality(val label: String, val maxBitrateKbps: Int) {
    DATA_SAVER("Data Saver (~64 kbps)", 72),
    BALANCED("Balanced (~128 kbps)", 140),
    HIGH("High Quality (Best)", Int.MAX_VALUE)
}

@Serializable
enum class AppThemeMode(val label: String) {
    DARK("Dark (Spotify / YT Music)"),
    SYSTEM("Follow System"),
    LIGHT("Light")
}

@Immutable
data class AppSettings(
    val audioQuality: AudioQuality = AudioQuality.HIGH,
    val themeMode: AppThemeMode = AppThemeMode.DARK,
    val dynamicColorEnabled: Boolean = false,
    val skipSilenceEnabled: Boolean = false,
    val autoplayEnabled: Boolean = true,
    val gaplessPlaybackEnabled: Boolean = true,
    val autoDownloadFavoritesWifi: Boolean = false,
    val screenSecurityEnabled: Boolean = false,
    val encryptBackupsEnabled: Boolean = true,
    val autoCheckUpdatesEnabled: Boolean = true,
    val lastUpdateCheckAtMs: Long = 0L
)
