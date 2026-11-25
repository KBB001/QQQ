package com.example.data.repository

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.example.domain.model.AppSettings
import com.example.domain.model.AppThemeMode
import com.example.domain.model.AudioQuality
import com.example.domain.repository.SettingsRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

private val Context.settingsDataStore: DataStore<Preferences> by preferencesDataStore(name = "sonora_settings")

@Singleton
class SettingsRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context
) : SettingsRepository {

    override val settings: Flow<AppSettings> = context.settingsDataStore.data
        .catch { exception ->
            if (exception is IOException) {
                emit(emptyPreferences())
            } else {
                throw exception
            }
        }
        .map { prefs ->
            val quality = prefs[KEY_AUDIO_QUALITY]
                ?.let { name -> AudioQuality.entries.firstOrNull { it.name == name } }
                ?: AudioQuality.HIGH
            val theme = prefs[KEY_THEME_MODE]
                ?.let { name -> AppThemeMode.entries.firstOrNull { it.name == name } }
                ?: AppThemeMode.DARK
            AppSettings(
                audioQuality = quality,
                themeMode = theme,
                dynamicColorEnabled = prefs[KEY_DYNAMIC_COLOR] ?: false,
                skipSilenceEnabled = prefs[KEY_SKIP_SILENCE] ?: false,
                autoplayEnabled = prefs[KEY_AUTOPLAY] ?: true,
                gaplessPlaybackEnabled = prefs[KEY_GAPLESS_PLAYBACK] ?: true,
                autoDownloadFavoritesWifi = prefs[KEY_AUTO_DOWNLOAD_FAVORITES_WIFI] ?: false,
                screenSecurityEnabled = prefs[KEY_SCREEN_SECURITY] ?: false,
                encryptBackupsEnabled = prefs[KEY_ENCRYPT_BACKUPS] ?: true,
                autoCheckUpdatesEnabled = prefs[KEY_AUTO_CHECK_UPDATES] ?: true,
                lastUpdateCheckAtMs = prefs[KEY_LAST_UPDATE_CHECK_AT_MS] ?: 0L
            )
        }

    override suspend fun setAudioQuality(quality: AudioQuality) {
        context.settingsDataStore.edit { it[KEY_AUDIO_QUALITY] = quality.name }
    }

    override suspend fun setThemeMode(themeMode: AppThemeMode) {
        context.settingsDataStore.edit { it[KEY_THEME_MODE] = themeMode.name }
    }

    override suspend fun setDynamicColorEnabled(enabled: Boolean) {
        context.settingsDataStore.edit { it[KEY_DYNAMIC_COLOR] = enabled }
    }

    override suspend fun setSkipSilenceEnabled(enabled: Boolean) {
        context.settingsDataStore.edit { it[KEY_SKIP_SILENCE] = enabled }
    }

    override suspend fun setAutoplayEnabled(enabled: Boolean) {
        context.settingsDataStore.edit { it[KEY_AUTOPLAY] = enabled }
    }

    override suspend fun setGaplessPlaybackEnabled(enabled: Boolean) {
        context.settingsDataStore.edit { it[KEY_GAPLESS_PLAYBACK] = enabled }
    }

    override suspend fun setAutoDownloadFavoritesWifi(enabled: Boolean) {
        context.settingsDataStore.edit { it[KEY_AUTO_DOWNLOAD_FAVORITES_WIFI] = enabled }
    }

    override suspend fun setScreenSecurityEnabled(enabled: Boolean) {
        context.settingsDataStore.edit { it[KEY_SCREEN_SECURITY] = enabled }
    }

    override suspend fun setEncryptBackupsEnabled(enabled: Boolean) {
        context.settingsDataStore.edit { it[KEY_ENCRYPT_BACKUPS] = enabled }
    }

    override suspend fun setAutoCheckUpdatesEnabled(enabled: Boolean) {
        context.settingsDataStore.edit { it[KEY_AUTO_CHECK_UPDATES] = enabled }
    }

    override suspend fun setLastUpdateCheckAtMs(timestampMs: Long) {
        context.settingsDataStore.edit { it[KEY_LAST_UPDATE_CHECK_AT_MS] = timestampMs }
    }

    private companion object {
        val KEY_AUDIO_QUALITY = stringPreferencesKey("audio_quality")
        val KEY_THEME_MODE = stringPreferencesKey("theme_mode")
        val KEY_DYNAMIC_COLOR = booleanPreferencesKey("dynamic_color")
        val KEY_SKIP_SILENCE = booleanPreferencesKey("skip_silence")
        val KEY_AUTOPLAY = booleanPreferencesKey("autoplay")
        val KEY_GAPLESS_PLAYBACK = booleanPreferencesKey("gapless_playback")
        val KEY_AUTO_DOWNLOAD_FAVORITES_WIFI = booleanPreferencesKey("auto_download_favorites_wifi")
        val KEY_SCREEN_SECURITY = booleanPreferencesKey("screen_security")
        val KEY_ENCRYPT_BACKUPS = booleanPreferencesKey("encrypt_backups")
        val KEY_AUTO_CHECK_UPDATES = booleanPreferencesKey("auto_check_updates")
        val KEY_LAST_UPDATE_CHECK_AT_MS = longPreferencesKey("last_update_check_at_ms")
    }
}
