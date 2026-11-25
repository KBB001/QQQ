package com.example

import com.example.core.common.DurationFormatter
import com.example.core.common.FriendlyErrorMapper
import com.example.core.common.SemverComparator
import com.example.data.remote.LyricsRepository
import com.example.data.remote.YouTubeMusicAccountApi
import com.example.data.remote.YouTubeRepositoryImpl
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException

class ExampleUnitTest {
    @Test
    fun durationFormatter_formatsMinutesAndHours() {
        assertEquals("0:00", DurationFormatter.formatSeconds(0))
        assertEquals("3:45", DurationFormatter.formatSeconds(225))
        assertEquals("1:02:05", DurationFormatter.formatSeconds(3725))
    }

    @Test
    fun semverComparator_comparesTagsAccurately() {
        assertTrue(SemverComparator.isNewerVersion("v1.0.1", "1.0.0"))
        assertTrue(SemverComparator.isNewerVersion("v1.0.10", "1.0.2"))
        assertTrue(SemverComparator.isNewerVersion("2.0", "1.9.9"))
        assertTrue(SemverComparator.isNewerVersion("v1.2.0", "v1.2.0-beta.1"))
        assertFalse(SemverComparator.isNewerVersion("v1.0.0", "1.0.0"))
        assertFalse(SemverComparator.isNewerVersion("v1.0", "1.0.0"))
        assertFalse(SemverComparator.isNewerVersion("v0.9.9", "1.0.0"))
        assertFalse(SemverComparator.isNewerVersion("invalid-tag", "1.0.0"))
    }

    @Test
    fun youtubeRepository_handlesEmptyInputGracefully() = runTest {
        val repo = YouTubeRepositoryImpl(OkHttpClient())
        val searchResult = repo.searchTracks("   ")
        assertTrue(searchResult.isSuccess)
        assertEquals(emptyList<Any>(), searchResult.getOrThrow())

        val streamResult = repo.getAudioStreamUrl("   ")
        assertTrue(streamResult.isFailure)

        val playlistResult = repo.getPlaylistTracks("")
        assertTrue(playlistResult.isFailure)
    }

    @Test
    fun youtubeAccountApi_validatesCookiesAndBuildsSapisidHash() {
        val validCookies = "SID=abc123; SAPISID=xyz789/hash; HSID=def456"
        assertTrue(YouTubeMusicAccountApi.hasAuthCookies(validCookies))
        assertEquals("xyz789/hash", YouTubeMusicAccountApi.extractSapisid(validCookies))

        val authHeader = YouTubeMusicAccountApi.buildSapisidHashHeader(
            sapisid = "xyz789/hash",
            origin = YouTubeMusicAccountApi.YOUTUBE_MUSIC_ORIGIN,
            timestampSeconds = 1700000000L
        )
        assertTrue(authHeader.startsWith("SAPISIDHASH 1700000000_"))
        assertEquals(40, authHeader.substringAfter('_').length)

        val netscapeCookies = """
            # Netscape HTTP Cookie File
            .youtube.com	TRUE	/	TRUE	1800000000	__Secure-3PAPISID	sapi_val
            .youtube.com	TRUE	/	TRUE	1800000000	__Secure-3PSID	sid_val
        """.trimIndent()
        val normalized = YouTubeMusicAccountApi.normalizeCookieHeader(netscapeCookies)
        assertTrue(YouTubeMusicAccountApi.hasAuthCookies(normalized))
        assertEquals("sapi_val", YouTubeMusicAccountApi.extractSapisid(normalized))
        assertFalse(YouTubeMusicAccountApi.hasAuthCookies("VISITOR_INFO1_LIVE=only_guest"))

        // Personal account DATASYNC_ID ("112233||") must NOT produce a delegated Brand Page ID
        org.junit.Assert.assertNull(YouTubeMusicAccountApi.extractDelegatedBrandPageId("112233445566||"))
        org.junit.Assert.assertNull(YouTubeMusicAccountApi.extractDelegatedBrandPageId("112233445566||112233445566"))
        assertEquals("1099887766", YouTubeMusicAccountApi.extractDelegatedBrandPageId("1099887766||112233445566"))

        val multiAuth = YouTubeMusicAccountApi.buildSapisidAuthorizationHeader(
            cookieHeader = "SAPISID=a; __Secure-1PAPISID=b; __Secure-3PAPISID=c; SID=s",
            timestampSeconds = 1700000000L
        ).orEmpty()
        assertTrue(multiAuth.contains("SAPISIDHASH 1700000000_"))
        assertTrue(multiAuth.contains("SAPISID1PHASH 1700000000_"))
        assertTrue(multiAuth.contains("SAPISID3PHASH 1700000000_"))
    }

    @Test
    fun friendlyErrorMapper_mapsNetworkAndPreservesRussianErrors() {
        val fallback = "Резервное сообщение"
        assertTrue(
            FriendlyErrorMapper.map(UnknownHostException("Unable to resolve host"), fallback)
                .contains("Нет подключения к интернету")
        )
        assertTrue(
            FriendlyErrorMapper.map(SocketTimeoutException("timeout"), fallback)
                .contains("Сервер долго не отвечает")
        )
        assertTrue(
            FriendlyErrorMapper.map(SSLException("handshake"), fallback)
                .contains("SSL")
        )
        assertTrue(
            FriendlyErrorMapper.map(IllegalStateException("HTTP 403 Forbidden"), fallback)
                .contains("Доступ к потоку")
        )
        assertTrue(
            FriendlyErrorMapper.map(IllegalStateException("HTTP 429"), fallback)
                .contains("Слишком много запросов")
        )
        assertEquals(
            "Трек временно недоступен",
            FriendlyErrorMapper.map(IllegalStateException("Трек временно недоступен"), fallback)
        )
        assertEquals(
            fallback,
            FriendlyErrorMapper.map(NullPointerException("java.lang.NullPointerException"), fallback)
        )
    }

    @Test
    fun lyricsRepository_parsesMultiTimestampLrcAndHandlesBlankTitle() = runTest {
        val repo = LyricsRepository(OkHttpClient())
        val lrc = """
            [ti:Test Song]
            [00:12.00][00:45.5]Chorus line
            [00:20.123]Verse line
            [00:30.00]
        """.trimIndent()

        val lines = repo.parseLrcLines(lrc)
        assertEquals(3, lines.size)
        assertEquals(12_000L, lines[0].timeMs)
        assertEquals("Chorus line", lines[0].text)
        assertEquals(20_123L, lines[1].timeMs)
        assertEquals("Verse line", lines[1].text)
        assertEquals(45_500L, lines[2].timeMs)
        assertEquals("Chorus line", lines[2].text)

        val blankResult = repo.fetchLyrics("   ", "Artist", 180L)
        assertTrue(blankResult.isFailure)
        assertEquals("Текст песни не найден", blankResult.exceptionOrNull()?.message)
    }

    @Test
    fun trackMoodProfiler_classifiesMoodsTempoAndComputesSimilarity() {
        val profiler = com.example.domain.recommendation.TrackMoodProfiler()
        val phonk = com.example.domain.model.Track(
            id = "p1",
            title = "Midnight Drift Phonk Gym",
            artist = "FastArtist",
            durationSeconds = 140,
            thumbnailUrl = ""
        )
        val lofi1 = com.example.domain.model.Track(
            id = "l1",
            title = "Rainy Window Lofi Beats to Study",
            artist = "ChillArtist - Topic",
            durationSeconds = 190,
            thumbnailUrl = ""
        )
        val lofi2 = com.example.domain.model.Track(
            id = "l2",
            title = "Warm Coffee Chillhop Instrumental",
            artist = "OtherChill",
            durationSeconds = 210,
            thumbnailUrl = ""
        )

        val phonkProfile = profiler.profile(phonk)
        val lofi1Profile = profiler.profile(lofi1)
        val lofi2Profile = profiler.profile(lofi2)

        assertEquals(com.example.domain.model.MoodCategory.WORKOUT_DRIVE, phonkProfile.mood)
        assertEquals(com.example.domain.model.TempoTier.HIGH_ENERGY, phonkProfile.tempo)
        assertEquals(com.example.domain.model.MoodCategory.CHILL_FOCUS, lofi1Profile.mood)
        assertEquals("chillartist", lofi1Profile.normalizedArtist)

        val sameMoodSim = profiler.similarityScore(lofi1Profile, lofi2Profile)
        val crossMoodSim = profiler.similarityScore(lofi1Profile, phonkProfile)
        assertTrue("Expected chill tracks similarity ($sameMoodSim) > cross mood ($crossMoodSim)", sameMoodSim > crossMoodSim)

        val contrasting = profiler.contrastingMoodsFor(com.example.domain.model.MoodCategory.WORKOUT_DRIVE)
        assertTrue(com.example.domain.model.MoodCategory.CHILL_FOCUS in contrasting)
        assertFalse(com.example.domain.model.MoodCategory.WORKOUT_DRIVE in contrasting)
    }

    @Test
    fun equalizerState_activePresetLabelAndBackupSerializationWork() {
        val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

        val eqCustom = com.example.playback.EqualizerState(
            selectedPresetIndex = 1,
            customBandsApplied = true
        )
        assertEquals("Пользовательский", eqCustom.activePresetLabel)

        val eqPreset = com.example.playback.EqualizerState(
            selectedPresetIndex = 1,
            customBandsApplied = false
        )
        assertEquals("Bass Boost", eqPreset.activePresetLabel)

        val legacyEqJson = """{"isEnabled":true,"selectedPresetIndex":2,"bandLevels":[100,200,0,-100,150],"customBandsApplied":true}"""
        val decodedLegacyEq = json.decodeFromString<com.example.domain.model.PersistedEqualizerState>(legacyEqJson)
        assertTrue(decodedLegacyEq.isEnabled)
        assertEquals(0, decodedLegacyEq.bassBoostStrength)
        assertFalse(decodedLegacyEq.virtualizerEnabled)
        assertEquals(600, decodedLegacyEq.virtualizerStrength)

        val modernEq = com.example.domain.model.PersistedEqualizerState(
            isEnabled = true,
            selectedPresetIndex = 1,
            bandLevels = listOf(650, 450, 100, 0, 150),
            customBandsApplied = false,
            bassBoostStrength = 750,
            virtualizerEnabled = true,
            virtualizerStrength = 800
        )
        val roundTrippedEq = json.decodeFromString<com.example.domain.model.PersistedEqualizerState>(
            json.encodeToString(com.example.domain.model.PersistedEqualizerState.serializer(), modernEq)
        )
        assertEquals(modernEq, roundTrippedEq)

        val backup = com.example.domain.model.LibraryBackup(
            settings = com.example.domain.model.BackupSettings(
                audioQuality = com.example.domain.model.AudioQuality.HIGH,
                gaplessPlaybackEnabled = false,
                autoDownloadFavoritesWifi = true
            ),
            equalizer = modernEq
        )
        val decodedBackup = json.decodeFromString<com.example.domain.model.LibraryBackup>(
            json.encodeToString(com.example.domain.model.LibraryBackup.serializer(), backup)
        )
        assertTrue(decodedBackup.settings?.autoDownloadFavoritesWifi == true)
        assertFalse(decodedBackup.settings?.gaplessPlaybackEnabled == true)
        assertEquals(750, decodedBackup.equalizer?.bassBoostStrength)
        assertTrue(decodedBackup.equalizer?.virtualizerEnabled == true)

        val legacyBackupJson = """{"version":1,"settings":{"audioQuality":"BALANCED","autoplayEnabled":false}}"""
        val decodedLegacyBackup = json.decodeFromString<com.example.domain.model.LibraryBackup>(legacyBackupJson)
        assertTrue(decodedLegacyBackup.settings?.gaplessPlaybackEnabled == true)
        assertFalse(decodedLegacyBackup.settings?.autoplayEnabled == true)
    }

    @Test
    fun appSettings_defaultsIncludeGaplessPlaybackEnabled() {
        val defaults = com.example.domain.model.AppSettings()
        assertTrue(defaults.gaplessPlaybackEnabled)
    }

    @Test
    fun durationFormatter_formatsTrackCountWithRussianPlurals() {
        assertEquals("0 треков", DurationFormatter.formatTrackCount(0))
        assertEquals("1 трек", DurationFormatter.formatTrackCount(1))
        assertEquals("2 трека", DurationFormatter.formatTrackCount(2))
        assertEquals("4 трека", DurationFormatter.formatTrackCount(4))
        assertEquals("5 треков", DurationFormatter.formatTrackCount(5))
        assertEquals("11 треков", DurationFormatter.formatTrackCount(11))
        assertEquals("14 треков", DurationFormatter.formatTrackCount(14))
        assertEquals("21 трек", DurationFormatter.formatTrackCount(21))
        assertEquals("22 трека", DurationFormatter.formatTrackCount(22))
        assertEquals("105 треков", DurationFormatter.formatTrackCount(105))
    }

    @Test
    fun homeUiState_startsWithPersonalizedForYouMood() {
        assertEquals(
            com.example.ui.home.HomeUiState.MOOD_FOR_YOU,
            com.example.ui.home.HomeUiState.MOOD_CHIPS.first()
        )
        assertTrue(
            com.example.ui.home.HomeUiState.toSearchQuery("Lo-Fi биты").isNotBlank()
        )
    }

    @Test
    fun durationFormatter_formatsBytesAccurately() {
        assertEquals("0 МБ", DurationFormatter.formatBytes(0L))
        assertEquals("0 МБ", DurationFormatter.formatBytes(-512L))
        assertEquals("2.5 МБ", DurationFormatter.formatBytes((2.5 * 1024 * 1024).toLong()))
        assertEquals("42 МБ", DurationFormatter.formatBytes(42L * 1024L * 1024L))
        assertEquals("1.50 ГБ", DurationFormatter.formatBytes((1.5 * 1024 * 1024 * 1024).toLong()))
    }

    @Test
    fun searchViewModel_detectsYouTubeUrlsAndMaintainsThreeFilters() {
        assertTrue(com.example.ui.search.SearchViewModel.isYouTubeUrl("https://music.youtube.com/watch?v=abc123"))
        assertTrue(com.example.ui.search.SearchViewModel.isYouTubeUrl("https://youtu.be/xyz789"))
        assertFalse(com.example.ui.search.SearchViewModel.isYouTubeUrl("Каспийский Груз"))

        assertTrue(com.example.ui.search.SearchViewModel.isYouTubePlaylistUrl("https://music.youtube.com/playlist?list=PL123"))
        assertFalse(com.example.ui.search.SearchViewModel.isYouTubePlaylistUrl("https://music.youtube.com/watch?v=abc123"))

        assertEquals(
            listOf(
                com.example.domain.model.SearchFilter.TRACKS,
                com.example.domain.model.SearchFilter.PLAYLISTS,
                com.example.domain.model.SearchFilter.ARTISTS
            ),
            com.example.domain.model.SearchFilter.entries
        )

        val defaultErr = com.example.ui.search.SearchResultsState.Error("Ошибка")
        assertFalse(defaultErr.isNetworkError)
        val netErr = com.example.ui.search.SearchResultsState.Error("Нет сети", isNetworkError = true)
        assertTrue(netErr.isNetworkError)
    }

    @Test
    fun settingsUiState_computesTotalStorageBytes() {
        val state = com.example.ui.settings.SettingsUiState(
            cacheSizeBytes = 120_000_000L,
            offlineDownloadsBytes = 380_000_000L
        )
        assertEquals(500_000_000L, state.totalStorageBytes)
    }

    @Test
    fun backupCipher_encryptsDecryptsAndDetectsTampering() {
        val plain = """{"version":2,"favorites":[{"id":"trk1","title":"Song"}]}"""
        val encrypted = com.example.core.security.BackupCipher.encrypt(plain, "StrongPass123")
        assertTrue(com.example.core.security.BackupCipher.isEncryptedBackup(encrypted))
        assertFalse(encrypted.contains("Song"))
        assertFalse(com.example.core.security.BackupCipher.isEncryptedBackup(plain))

        val decrypted = com.example.core.security.BackupCipher.decrypt(encrypted, "StrongPass123")
        assertTrue(decrypted.isSuccess)
        assertEquals(plain, decrypted.getOrThrow())

        val wrongPwd = com.example.core.security.BackupCipher.decrypt(encrypted, "WrongPass999")
        assertTrue(wrongPwd.isFailure)

        val match = Regex("\"ciphertext\"\\s*:\\s*\"([A-Za-z0-9+/=]+)\"").find(encrypted)!!
        val origCt = match.groupValues[1]
        val flippedChar = if (origCt.first() == 'A') 'B' else 'A'
        val tamperedCt = flippedChar + origCt.substring(1)
        val tampered = encrypted.replaceFirst(origCt, tamperedCt)
        val tamperedRes = com.example.core.security.BackupCipher.decrypt(tampered, "StrongPass123")
        assertTrue(tamperedRes.isFailure)
    }

    @Test
    fun httpsOnlyInterceptor_blocksCleartextHttpAndTracksHost() {
        val tracker = com.example.core.security.SecurityStatusTracker()
        val interceptor = com.example.core.security.HttpsOnlyInterceptor(tracker)

        val httpRequest = okhttp3.Request.Builder()
            .url("http://insecure.example.org/audio.mp3")
            .build()

        var thrown: Throwable? = null
        try {
            interceptor.intercept(FakeChain(httpRequest))
        } catch (t: Throwable) {
            thrown = t
        }
        assertTrue(thrown is javax.net.ssl.SSLPeerUnverifiedException)
        assertEquals(1, tracker.blockedInsecureCount.value)
        assertEquals("insecure.example.org", tracker.lastBlockedHost.value)

        val httpsRequest = okhttp3.Request.Builder()
            .url("https://music.youtube.com/browse")
            .build()
        val resp = interceptor.intercept(FakeChain(httpsRequest))
        assertEquals(200, resp.code)
        assertEquals(1, tracker.blockedInsecureCount.value)
    }

    @Test
    fun appSettings_defaultsAndSha256ComputationAreSecure() {
        val defaults = com.example.domain.model.AppSettings()
        assertTrue(defaults.encryptBackupsEnabled)
        assertTrue(defaults.autoCheckUpdatesEnabled)
        assertFalse(defaults.screenSecurityEnabled)
        assertEquals(0L, defaults.lastUpdateCheckAtMs)

        val temp = kotlin.io.path.createTempFile("sonora_hash_test", ".bin").toFile()
        try {
            temp.writeText("sonora-security-test", Charsets.UTF_8)
            val hash = com.example.core.common.ApkInstaller.computeFileSha256(temp)
            assertEquals(64, hash?.length)
            assertEquals(hash, com.example.core.common.ApkInstaller.computeFileSha256(temp))
        } finally {
            temp.delete()
        }
    }

    private class FakeChain(private val req: okhttp3.Request) : okhttp3.Interceptor.Chain {
        override fun request(): okhttp3.Request = req
        override fun proceed(request: okhttp3.Request): okhttp3.Response {
            return okhttp3.Response.Builder()
                .request(request)
                .protocol(okhttp3.Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
                .build()
        }
        override fun connection(): okhttp3.Connection? = null
        override fun call(): okhttp3.Call = throw UnsupportedOperationException()
        override fun connectTimeoutMillis(): Int = 10_000
        override fun withConnectTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit): okhttp3.Interceptor.Chain = this
        override fun readTimeoutMillis(): Int = 10_000
        override fun withReadTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit): okhttp3.Interceptor.Chain = this
        override fun writeTimeoutMillis(): Int = 10_000
        override fun withWriteTimeout(timeout: Int, unit: java.util.concurrent.TimeUnit): okhttp3.Interceptor.Chain = this
    }
}
