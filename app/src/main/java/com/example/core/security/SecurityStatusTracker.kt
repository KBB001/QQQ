package com.example.core.security

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SecurityStatusTracker @Inject constructor() {

    private val _blockedInsecureCount = MutableStateFlow(0)
    val blockedInsecureCount: StateFlow<Int> = _blockedInsecureCount.asStateFlow()

    private val _lastBlockedHost = MutableStateFlow<String?>(null)
    val lastBlockedHost: StateFlow<String?> = _lastBlockedHost.asStateFlow()

    private val _databaseEncrypted = MutableStateFlow(false)
    val databaseEncrypted: StateFlow<Boolean> = _databaseEncrypted.asStateFlow()

    private val _keystoreBacked = MutableStateFlow(false)
    val keystoreBacked: StateFlow<Boolean> = _keystoreBacked.asStateFlow()

    fun recordBlockedInsecureConnection(rawUrl: String?) {
        val host = rawUrl
            ?.trim()
            ?.let { runCatching { java.net.URI(it).host }.getOrNull() }
            ?.takeIf { it.isNotBlank() }
            ?: "http-endpoint"
        _blockedInsecureCount.update { it + 1 }
        _lastBlockedHost.value = host
    }

    fun setDatabaseEncrypted(encrypted: Boolean) {
        _databaseEncrypted.value = encrypted
    }

    fun setKeystoreBacked(backed: Boolean) {
        _keystoreBacked.value = backed
    }
}
