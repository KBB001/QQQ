package com.example.ui.navigation

import kotlinx.serialization.Serializable

sealed interface SonoraRoute {
    @Serializable
    data object Home : SonoraRoute

    @Serializable
    data object Search : SonoraRoute

    @Serializable
    data object Library : SonoraRoute

    @Serializable
    data object Settings : SonoraRoute

    @Serializable
    data class PlaylistDetail(val playlistId: Long) : SonoraRoute

    @Serializable
    data object NowPlaying : SonoraRoute

    @Serializable
    data class YouTubeLogin(val resetSession: Boolean = false) : SonoraRoute

    @Serializable
    data object EqualizerSettings : SonoraRoute

    @Serializable
    data object CacheQualitySettings : SonoraRoute

    @Serializable
    data object YouTubeAccountSettings : SonoraRoute

    @Serializable
    data object YouTubeSignOutConfirm : SonoraRoute

    @Serializable
    data object AppUpdateSettings : SonoraRoute

    @Serializable
    data object SecuritySettings : SonoraRoute
}
