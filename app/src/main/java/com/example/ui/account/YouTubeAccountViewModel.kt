package com.example.ui.account

import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.common.FriendlyErrorMapper
import com.example.core.common.NetworkMonitor
import com.example.domain.model.AccountSyncState
import com.example.domain.model.AccountSyncSummary
import com.example.domain.model.YouTubeAccount
import com.example.domain.repository.LibraryRepository
import com.example.domain.repository.YouTubeAccountRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@Immutable
data class YouTubeAccountUiState(
    val accounts: List<YouTubeAccount> = emptyList(),
    val activeAccount: YouTubeAccount? = null,
    val autoSyncEnabled: Boolean = true,
    val syncState: AccountSyncState = AccountSyncState.Idle,
    val isSigningIn: Boolean = false,
    val favoriteCount: Int = 0,
    val playlistCount: Int = 0,
    val historyCount: Int = 0,
    val isOnline: Boolean = true
)

@HiltViewModel
class YouTubeAccountViewModel @Inject constructor(
    private val accountRepository: YouTubeAccountRepository,
    private val libraryRepository: LibraryRepository,
    private val networkMonitor: NetworkMonitor
) : ViewModel() {

    private val isSigningInFlow = MutableStateFlow(false)

    private val accountDataFlow = combine(
        accountRepository.accounts,
        accountRepository.activeAccount,
        accountRepository.autoSyncEnabled,
        accountRepository.syncState,
        isSigningInFlow
    ) { accounts, active, autoSync, syncState, isSigningIn ->
        AccountBaseState(
            accounts = accounts,
            activeAccount = active,
            autoSyncEnabled = autoSync,
            syncState = syncState,
            isSigningIn = isSigningIn
        )
    }

    private val libraryCountsFlow = combine(
        libraryRepository.observeFavoriteIds().map { it.size },
        libraryRepository.observePlaylists().map { it.size },
        libraryRepository.observeHistory().map { it.size },
        networkMonitor.isOnline
    ) { favorites, playlists, history, isOnline ->
        LibraryStats(favorites, playlists, history, isOnline)
    }

    val uiState: StateFlow<YouTubeAccountUiState> = combine(
        accountDataFlow,
        libraryCountsFlow
    ) { base, stats ->
        YouTubeAccountUiState(
            accounts = base.accounts,
            activeAccount = base.activeAccount,
            autoSyncEnabled = base.autoSyncEnabled,
            syncState = base.syncState,
            isSigningIn = base.isSigningIn,
            favoriteCount = stats.favorites,
            playlistCount = stats.playlists,
            historyCount = stats.history,
            isOnline = stats.isOnline
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = YouTubeAccountUiState()
    )

    fun signInWithSession(
        cookieHeader: String,
        visitorData: String = "",
        dataSyncId: String = "",
        authUserIndex: Int = 0,
        syncImmediately: Boolean = true,
        onSuccess: (YouTubeAccount) -> Unit,
        onError: (String) -> Unit
    ) {
        if (isSigningInFlow.value) return
        viewModelScope.launch {
            isSigningInFlow.value = true
            val result = accountRepository.signInWithSession(
                cookieHeader = cookieHeader,
                visitorData = visitorData,
                dataSyncId = dataSyncId,
                authUserIndex = authUserIndex
            )
            isSigningInFlow.value = false
            result.fold(
                onSuccess = { account ->
                    onSuccess(account)
                    if (syncImmediately) {
                        accountRepository.syncAndMergeActiveAccount()
                    }
                },
                onFailure = { err ->
                    onError(FriendlyErrorMapper.map(err, "Не удалось войти в аккаунт YouTube"))
                }
            )
        }
    }

    fun switchActiveAccount(accountId: String, onMessage: (String) -> Unit) {
        viewModelScope.launch {
            accountRepository.switchActiveAccount(accountId)
            val name = uiState.value.accounts.firstOrNull { it.id == accountId }?.name ?: "YouTube"
            onMessage("Активный аккаунт: $name")
        }
    }

    fun removeAccount(accountId: String, onMessage: (String) -> Unit) {
        viewModelScope.launch {
            accountRepository.removeAccount(accountId)
            onMessage("Аккаунт отключён")
        }
    }

    fun signOutAll(onMessage: (String) -> Unit) {
        viewModelScope.launch {
            accountRepository.signOutAll()
            onMessage("Вы вышли из аккаунтов YouTube")
        }
    }

    fun setAutoSyncEnabled(enabled: Boolean) {
        viewModelScope.launch {
            accountRepository.setAutoSyncEnabled(enabled)
        }
    }

    fun syncAndMergeActiveAccount(onMessage: (String) -> Unit) {
        if (uiState.value.syncState is AccountSyncState.Syncing) return
        viewModelScope.launch {
            accountRepository.syncAndMergeActiveAccount().fold(
                onSuccess = { summary ->
                    onMessage(formatSyncSummary(summary))
                },
                onFailure = { err ->
                    onMessage(FriendlyErrorMapper.map(err, "Ошибка синхронизации с YouTube"))
                }
            )
        }
    }

    fun unifyAllAccountsIntoActive(onMessage: (String) -> Unit) {
        if (uiState.value.syncState is AccountSyncState.Syncing) return
        viewModelScope.launch {
            accountRepository.unifyAllAccountsIntoActive().fold(
                onSuccess = { summary ->
                    onMessage(formatSyncSummary(summary))
                },
                onFailure = { err ->
                    onMessage(FriendlyErrorMapper.map(err, "Ошибка объединения аккаунтов"))
                }
            )
        }
    }

    fun clearSyncState() {
        accountRepository.clearSyncState()
    }

    private fun formatSyncSummary(summary: AccountSyncSummary): String {
        val parts = buildList {
            if (summary.importedLiked > 0) add("+${summary.importedLiked} в избранное")
            if (summary.uploadedLiked > 0) add("↑${summary.uploadedLiked} лайков в YouTube")
            if (summary.importedPlaylists > 0) add("+${summary.importedPlaylists} плейлистов из YouTube")
            if (summary.uploadedPlaylists > 0) add("↑${summary.uploadedPlaylists} плейлистов в YouTube")
            if (summary.importedHistory > 0) add("+${summary.importedHistory} из истории")
        }
        return if (parts.isEmpty()) {
            "Медиатека полностью синхронизирована с YouTube"
        } else {
            "Готово: ${parts.joinToString(", ")}"
        }
    }

    private data class AccountBaseState(
        val accounts: List<YouTubeAccount>,
        val activeAccount: YouTubeAccount?,
        val autoSyncEnabled: Boolean,
        val syncState: AccountSyncState,
        val isSigningIn: Boolean
    )

    private data class LibraryStats(
        val favorites: Int,
        val playlists: Int,
        val history: Int,
        val isOnline: Boolean
    )
}
