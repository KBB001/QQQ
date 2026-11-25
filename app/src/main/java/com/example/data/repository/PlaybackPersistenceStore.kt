package com.example.data.repository

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.example.domain.model.PersistedEqualizerState
import com.example.domain.model.PersistedPlaybackState
import com.example.domain.model.Track
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

private val Context.playbackStateDataStore: DataStore<Preferences> by preferencesDataStore(
    name = "sonora_playback_state"
)

@Singleton
class PlaybackPersistenceStore @Inject constructor(
    @ApplicationContext private val context: Context,
    private val cipher: SecureAccountCipher
) {
    constructor(context: Context) : this(context, SecureAccountCipher(context))

    private val jsonCodec = Json {
        ignoreUnknownKeys = true
    }

    suspend fun readPlaybackState(): PersistedPlaybackState? = runCatching {
        val prefs = context.playbackStateDataStore.data.first()
        val raw = prefs[KEY_PLAYBACK_STATE] ?: return null
        val json = if (cipher.isEncryptedPayload(raw)) {
            cipher.decrypt(raw) ?: return null
        } else {
            raw
        }
        sanitizePlaybackState(jsonCodec.decodeFromString<PersistedPlaybackState>(json))
    }.getOrNull()

    suspend fun savePlaybackState(state: PersistedPlaybackState) {
        val sanitized = sanitizePlaybackState(state)
        runCatching {
            val encoded = jsonCodec.encodeToString(sanitized)
            val encrypted = cipher.encrypt(encoded)
            context.playbackStateDataStore.edit { prefs ->
                prefs[KEY_PLAYBACK_STATE] = encrypted
            }
        }
    }

    suspend fun readEqualizerState(): PersistedEqualizerState? = runCatching {
        val prefs = context.playbackStateDataStore.data.first()
        val raw = prefs[KEY_EQUALIZER_STATE] ?: return null
        val json = if (cipher.isEncryptedPayload(raw)) {
            cipher.decrypt(raw) ?: return null
        } else {
            raw
        }
        sanitizeEqualizerState(jsonCodec.decodeFromString<PersistedEqualizerState>(json))
    }.getOrNull()

    suspend fun saveEqualizerState(state: PersistedEqualizerState) {
        val sanitized = sanitizeEqualizerState(state)
        runCatching {
            val encoded = jsonCodec.encodeToString(sanitized)
            val encrypted = cipher.encrypt(encoded)
            context.playbackStateDataStore.edit { prefs ->
                prefs[KEY_EQUALIZER_STATE] = encrypted
            }
        }
    }

    suspend fun clearAll() {
        runCatching {
            context.playbackStateDataStore.edit { prefs ->
                prefs.remove(KEY_PLAYBACK_STATE)
                prefs.remove(KEY_EQUALIZER_STATE)
            }
        }
    }

    private fun sanitizePlaybackState(state: PersistedPlaybackState): PersistedPlaybackState {
        val cleanQueue = state.queue
            .filter { it.id.isNotBlank() }
            .take(MAX_PERSISTED_QUEUE_SIZE)
            .map(::sanitizeTrack)
        val clampedIndex = if (cleanQueue.isEmpty()) {
            -1
        } else {
            state.currentIndex.coerceIn(0, cleanQueue.lastIndex)
        }
        return PersistedPlaybackState(
            queue = cleanQueue,
            currentIndex = clampedIndex,
            positionMs = state.positionMs.coerceAtLeast(0L),
            shuffleEnabled = state.shuffleEnabled,
            repeatMode = state.repeatMode,
            playbackSpeed = state.playbackSpeed.coerceIn(0.5f, 2.0f)
        )
    }

    private fun sanitizeEqualizerState(state: PersistedEqualizerState): PersistedEqualizerState {
        return PersistedEqualizerState(
            isEnabled = state.isEnabled,
            selectedPresetIndex = state.selectedPresetIndex.coerceAtLeast(0),
            bandLevels = state.bandLevels.take(16).map { it.coerceIn(-3000, 3000) },
            customBandsApplied = state.customBandsApplied,
            bassBoostStrength = state.bassBoostStrength.coerceIn(0, 1000),
            virtualizerEnabled = state.virtualizerEnabled,
            virtualizerStrength = state.virtualizerStrength.coerceIn(0, 1000)
        )
    }

    private fun sanitizeTrack(track: Track): Track = track.copy(
        id = track.id.trim().take(64),
        title = track.title.trim().take(240).ifBlank { "Без названия" },
        artist = track.artist.trim().take(200).ifBlank { "Неизвестный исполнитель" },
        durationSeconds = track.durationSeconds.coerceAtLeast(0L),
        thumbnailUrl = track.thumbnailUrl
            .trim()
            .takeIf { it.startsWith("https://", ignoreCase = true) }
            .orEmpty(),
        streamUrl = null
    )

    private companion object {
        val KEY_PLAYBACK_STATE = stringPreferencesKey("playback_state_json")
        val KEY_EQUALIZER_STATE = stringPreferencesKey("equalizer_state_json")
        const val MAX_PERSISTED_QUEUE_SIZE = 500
    }
}
