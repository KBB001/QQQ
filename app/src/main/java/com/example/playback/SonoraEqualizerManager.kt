package com.example.playback

import android.media.audiofx.BassBoost
import android.media.audiofx.Equalizer
import android.media.audiofx.Virtualizer
import com.example.data.repository.PlaybackPersistenceStore
import com.example.domain.model.PersistedEqualizerState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

data class EqualizerState(
    val isAvailable: Boolean = false,
    val isEnabled: Boolean = false,
    val bandLevels: List<Short> = SonoraEqualizerManager.DEFAULT_FLAT_LEVELS,
    val bandFrequenciesHz: List<Int> = SonoraEqualizerManager.DEFAULT_BAND_FREQS_HZ,
    val minLevelMb: Short = -1500,
    val maxLevelMb: Short = 1500,
    val presetNames: List<String> = SonoraEqualizerManager.DEFAULT_PRESET_NAMES,
    val selectedPresetIndex: Int = 0,
    val customBandsApplied: Boolean = false,
    val bassBoostStrength: Int = 0, // 0..1000
    val bassBoostSupported: Boolean = true,
    val virtualizerEnabled: Boolean = false,
    val virtualizerSupported: Boolean = true
) {
    val activePresetLabel: String
        get() = if (customBandsApplied) {
            "Пользовательский"
        } else {
            presetNames.getOrElse(selectedPresetIndex) { "Обычный" }
        }
}

@Singleton
class SonoraEqualizerManager @Inject constructor(
    private val persistenceStore: PlaybackPersistenceStore
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var equalizer: Equalizer? = null
    private var bassBoost: BassBoost? = null
    private var virtualizer: Virtualizer? = null
    private var currentSessionId: Int = 0
    private var desiredConfig: PersistedEqualizerState = PersistedEqualizerState()
    private var userModifiedConfig = false
    private val initialLoadJob: Job

    private val _state = MutableStateFlow(EqualizerState())
    val state: StateFlow<EqualizerState> = _state.asStateFlow()

    init {
        initialLoadJob = scope.launch {
            val restored = persistenceStore.readEqualizerState() ?: return@launch
            if (!userModifiedConfig) {
                desiredConfig = restored
                val eq = equalizer
                if (eq != null) {
                    applyDesiredConfig(eq, restored)
                } else {
                    syncPreSessionStateFromConfig(restored)
                }
            }
        }
    }

    fun attachToSession(audioSessionId: Int) {
        if (audioSessionId <= 0 || audioSessionId == currentSessionId) return
        release()
        currentSessionId = audioSessionId

        val eqResult = runCatching {
            val eq = Equalizer(0, audioSessionId)
            equalizer = eq
            eq
        }

        val bassSupported = runCatching {
            val bb = BassBoost(0, audioSessionId)
            bassBoost = bb
            bb.strengthSupported
        }.getOrDefault(false)

        val virtSupported = runCatching {
            @Suppress("DEPRECATION")
            val virt = Virtualizer(0, audioSessionId)
            virtualizer = virt
            virt.strengthSupported
        }.getOrDefault(false)

        eqResult.onSuccess { eq ->
            applyDesiredConfig(
                eq = eq,
                config = desiredConfig,
                bassSupported = bassSupported,
                virtSupported = virtSupported
            )
        }.onFailure {
            syncPreSessionStateFromConfig(
                config = desiredConfig,
                isAvailable = false,
                bassSupported = bassSupported,
                virtSupported = virtSupported
            )
        }
    }

    private fun syncPreSessionStateFromConfig(
        config: PersistedEqualizerState,
        isAvailable: Boolean = _state.value.isAvailable,
        bassSupported: Boolean = _state.value.bassBoostSupported,
        virtSupported: Boolean = _state.value.virtualizerSupported
    ) {
        val current = _state.value
        val presetIdx = config.selectedPresetIndex.coerceIn(0, DEFAULT_PRESET_NAMES.lastIndex)
        val levels = when {
            config.bandLevels.size == DEFAULT_BAND_FREQS_HZ.size -> config.bandLevels
            !config.customBandsApplied -> DEFAULT_PRESET_CURVES.getOrElse(presetIdx) { DEFAULT_FLAT_LEVELS }
            else -> current.bandLevels.ifEmpty { DEFAULT_FLAT_LEVELS }
        }
        _state.value = current.copy(
            isAvailable = isAvailable,
            isEnabled = config.isEnabled,
            bandLevels = levels,
            bandFrequenciesHz = current.bandFrequenciesHz.ifEmpty { DEFAULT_BAND_FREQS_HZ },
            presetNames = current.presetNames.ifEmpty { DEFAULT_PRESET_NAMES },
            selectedPresetIndex = presetIdx,
            customBandsApplied = config.customBandsApplied,
            bassBoostStrength = config.bassBoostStrength.coerceIn(0, 1000),
            bassBoostSupported = bassSupported,
            virtualizerEnabled = config.virtualizerEnabled,
            virtualizerSupported = virtSupported
        )
    }

    private fun applyDesiredConfig(
        eq: Equalizer,
        config: PersistedEqualizerState,
        bassSupported: Boolean = _state.value.bassBoostSupported,
        virtSupported: Boolean = _state.value.virtualizerSupported
    ) {
        runCatching {
            eq.enabled = config.isEnabled
            val numBands = eq.numberOfBands.toInt()
            val range = eq.bandLevelRange
            val minMb = range.getOrElse(0) { -1500 }
            val maxMb = range.getOrElse(1) { 1500 }
            val hwPresets = (0 until eq.numberOfPresets).map { eq.getPresetName(it.toShort()) }
            val presetNames = hwPresets.ifEmpty { DEFAULT_PRESET_NAMES }
            val safePreset = config.selectedPresetIndex.coerceIn(0, (presetNames.size - 1).coerceAtLeast(0))

            if (config.customBandsApplied && config.bandLevels.size == numBands) {
                config.bandLevels.forEachIndexed { idx, level ->
                    eq.setBandLevel(idx.toShort(), level.coerceIn(minMb, maxMb))
                }
            } else if (safePreset in hwPresets.indices) {
                runCatching { eq.usePreset(safePreset.toShort()) }
            } else {
                val curve = DEFAULT_PRESET_CURVES.getOrElse(safePreset) { DEFAULT_FLAT_LEVELS }
                curve.take(numBands).forEachIndexed { idx, level ->
                    eq.setBandLevel(idx.toShort(), level.coerceIn(minMb, maxMb))
                }
            }

            applyBassBoostHardware(config.isEnabled, config.bassBoostStrength)
            applyVirtualizerHardware(config.isEnabled && config.virtualizerEnabled, config.virtualizerStrength)

            val freqs = (0 until numBands).map { eq.getCenterFreq(it.toShort()) / 1000 }
            val levels = (0 until numBands).map { eq.getBandLevel(it.toShort()) }

            _state.value = EqualizerState(
                isAvailable = true,
                isEnabled = eq.enabled,
                bandLevels = levels,
                bandFrequenciesHz = freqs,
                minLevelMb = minMb,
                maxLevelMb = maxMb,
                presetNames = presetNames,
                selectedPresetIndex = safePreset,
                customBandsApplied = config.customBandsApplied,
                bassBoostStrength = config.bassBoostStrength.coerceIn(0, 1000),
                bassBoostSupported = bassSupported,
                virtualizerEnabled = config.virtualizerEnabled,
                virtualizerSupported = virtSupported
            )
        }
    }

    private fun applyBassBoostHardware(masterEnabled: Boolean, strength: Int) {
        val bb = bassBoost ?: return
        val clamped = strength.coerceIn(0, 1000)
        runCatching {
            val active = masterEnabled && clamped > 0
            bb.enabled = active
            if (bb.strengthSupported) {
                bb.setStrength(clamped.toShort())
            }
        }
    }

    private fun applyVirtualizerHardware(active: Boolean, strength: Int) {
        val virt = virtualizer ?: return
        val clamped = strength.coerceIn(0, 1000)
        runCatching {
            @Suppress("DEPRECATION")
            run {
                virt.enabled = active
                if (virt.strengthSupported) {
                    virt.setStrength(clamped.toShort())
                }
            }
        }
    }

    fun setEnabled(enabled: Boolean) {
        userModifiedConfig = true
        desiredConfig = desiredConfig.copy(isEnabled = enabled)
        val eq = equalizer
        if (eq != null) {
            runCatching {
                eq.enabled = enabled
                applyBassBoostHardware(enabled, desiredConfig.bassBoostStrength)
                applyVirtualizerHardware(
                    enabled && desiredConfig.virtualizerEnabled,
                    desiredConfig.virtualizerStrength
                )
                _state.update { it.copy(isEnabled = eq.enabled) }
            }
        } else {
            _state.update { it.copy(isEnabled = enabled) }
        }
        persistDesiredConfig()
    }

    fun selectPreset(index: Int) {
        userModifiedConfig = true
        val eq = equalizer
        if (eq != null) {
            runCatching {
                val safeIdx = index.coerceIn(0, (_state.value.presetNames.size - 1).coerceAtLeast(0))
                if (safeIdx < eq.numberOfPresets) {
                    eq.usePreset(safeIdx.toShort())
                } else {
                    val range = eq.bandLevelRange
                    val minMb = range.getOrElse(0) { -1500 }
                    val maxMb = range.getOrElse(1) { 1500 }
                    val curve = DEFAULT_PRESET_CURVES.getOrElse(safeIdx) { DEFAULT_FLAT_LEVELS }
                    curve.take(eq.numberOfBands.toInt()).forEachIndexed { idx, level ->
                        eq.setBandLevel(idx.toShort(), level.coerceIn(minMb, maxMb))
                    }
                }
                val numBands = eq.numberOfBands.toInt()
                val levels = (0 until numBands).map { eq.getBandLevel(it.toShort()) }
                desiredConfig = desiredConfig.copy(
                    isEnabled = true,
                    selectedPresetIndex = safeIdx,
                    bandLevels = levels,
                    customBandsApplied = false
                )
                eq.enabled = true
                applyBassBoostHardware(true, desiredConfig.bassBoostStrength)
                applyVirtualizerHardware(desiredConfig.virtualizerEnabled, desiredConfig.virtualizerStrength)
                _state.update {
                    it.copy(
                        isEnabled = true,
                        selectedPresetIndex = safeIdx,
                        bandLevels = levels,
                        customBandsApplied = false
                    )
                }
                persistDesiredConfig()
            }
        } else {
            val safeIdx = index.coerceIn(0, DEFAULT_PRESET_NAMES.lastIndex)
            val levels = DEFAULT_PRESET_CURVES.getOrElse(safeIdx) { DEFAULT_FLAT_LEVELS }
            desiredConfig = desiredConfig.copy(
                isEnabled = true,
                selectedPresetIndex = safeIdx,
                bandLevels = levels,
                customBandsApplied = false
            )
            _state.update {
                it.copy(
                    isEnabled = true,
                    selectedPresetIndex = safeIdx,
                    bandLevels = levels,
                    customBandsApplied = false
                )
            }
            persistDesiredConfig()
        }
    }

    fun setBandLevel(bandIndex: Int, levelMb: Short) {
        userModifiedConfig = true
        val eq = equalizer
        if (eq != null) {
            runCatching {
                val range = eq.bandLevelRange
                val minMb = range.getOrElse(0) { -1500 }
                val maxMb = range.getOrElse(1) { 1500 }
                val clamped = levelMb.coerceIn(minMb, maxMb)
                eq.setBandLevel(bandIndex.toShort(), clamped)
                val numBands = eq.numberOfBands.toInt()
                val levels = (0 until numBands).map { eq.getBandLevel(it.toShort()) }
                desiredConfig = desiredConfig.copy(
                    bandLevels = levels,
                    customBandsApplied = true
                )
                _state.update {
                    it.copy(
                        bandLevels = levels,
                        customBandsApplied = true
                    )
                }
                persistDesiredConfig()
            }
        } else {
            val currentLevels = _state.value.bandLevels.ifEmpty { DEFAULT_FLAT_LEVELS }.toMutableList()
            if (bandIndex !in currentLevels.indices) return
            val clamped = levelMb.coerceIn(_state.value.minLevelMb, _state.value.maxLevelMb)
            currentLevels[bandIndex] = clamped
            desiredConfig = desiredConfig.copy(
                bandLevels = currentLevels,
                customBandsApplied = true
            )
            _state.update {
                it.copy(
                    bandLevels = currentLevels,
                    customBandsApplied = true
                )
            }
            persistDesiredConfig()
        }
    }

    fun setBassBoostStrength(strength: Int) {
        userModifiedConfig = true
        val clamped = strength.coerceIn(0, 1000)
        desiredConfig = desiredConfig.copy(bassBoostStrength = clamped)
        applyBassBoostHardware(desiredConfig.isEnabled, clamped)
        _state.update { it.copy(bassBoostStrength = clamped) }
        persistDesiredConfig()
    }

    fun setVirtualizerEnabled(enabled: Boolean) {
        userModifiedConfig = true
        desiredConfig = desiredConfig.copy(virtualizerEnabled = enabled)
        applyVirtualizerHardware(desiredConfig.isEnabled && enabled, desiredConfig.virtualizerStrength)
        _state.update { it.copy(virtualizerEnabled = enabled) }
        persistDesiredConfig()
    }

    fun resetToFlat() {
        selectPreset(0)
        setBassBoostStrength(0)
        setVirtualizerEnabled(false)
    }

    suspend fun getPersistedConfigSnapshot(): PersistedEqualizerState {
        initialLoadJob.join()
        return desiredConfig
    }

    suspend fun applyRestoredConfig(config: PersistedEqualizerState) {
        userModifiedConfig = true
        desiredConfig = config
        val eq = equalizer
        if (eq != null) {
            applyDesiredConfig(eq, config)
        } else {
            syncPreSessionStateFromConfig(config)
        }
        persistenceStore.saveEqualizerState(config)
    }

    private fun persistDesiredConfig() {
        val snapshot = desiredConfig
        scope.launch {
            persistenceStore.saveEqualizerState(snapshot)
        }
    }

    fun release() {
        runCatching { equalizer?.release() }
        runCatching { bassBoost?.release() }
        runCatching { virtualizer?.release() }
        equalizer = null
        bassBoost = null
        virtualizer = null
        currentSessionId = 0
        _state.update { it.copy(isAvailable = false) }
    }

    companion object {
        val DEFAULT_BAND_FREQS_HZ = listOf(60, 230, 910, 3600, 14000)
        val DEFAULT_FLAT_LEVELS: List<Short> = listOf(0, 0, 0, 0, 0)
        val DEFAULT_PRESET_NAMES = listOf(
            "Обычный",
            "Bass Boost",
            "Поп",
            "Рок",
            "Джаз",
            "Вокал"
        )
        val DEFAULT_PRESET_CURVES: List<List<Short>> = listOf(
            listOf(0, 0, 0, 0, 0),
            listOf(650, 450, 100, 0, 150),
            listOf(-150, 250, 450, 200, -100),
            listOf(450, 250, -100, 350, 500),
            listOf(350, 200, -150, 250, 350),
            listOf(-200, 100, 450, 400, 100)
        )
    }
}
