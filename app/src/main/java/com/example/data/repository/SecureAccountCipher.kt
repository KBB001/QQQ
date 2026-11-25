package com.example.data.repository

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.example.core.security.SecurityStatusTracker
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.KeyStore
import java.security.SecureRandom
import java.security.Security
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SecureAccountCipher @Inject constructor(
    @ApplicationContext private val context: Context,
    private val securityStatusTracker: SecurityStatusTracker? = null
) {
    private val keyLock = Any()

    @Volatile
    private var jvmEphemeralTestKey: SecretKey? = null

    fun isEncryptedPayload(raw: String?): Boolean =
        !raw.isNullOrBlank() && raw.startsWith(CIPHERTEXT_PREFIX)

    fun isKeystoreBacked(): Boolean {
        val backed = hasAndroidKeyStoreProvider()
        securityStatusTracker?.setKeystoreBacked(backed)
        return backed
    }

    fun encrypt(plaintext: String): String {
        val secretKey = getOrCreateSecretKey()
        val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
        if (isKeyStoreBackedKey()) {
            cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        } else {
            val iv = ByteArray(GCM_IV_LENGTH_BYTES).also { SecureRandom().nextBytes(it) }
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))
        }
        val ivBytes = cipher.iv
        val cipherBytes = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val ivB64 = Base64.encodeToString(ivBytes, Base64.NO_WRAP)
        val ctB64 = Base64.encodeToString(cipherBytes, Base64.NO_WRAP)
        return "$CIPHERTEXT_PREFIX$ivB64:$ctB64"
    }

    fun decrypt(payload: String): String? {
        if (!isEncryptedPayload(payload)) return payload
        val encoded = payload.removePrefix(CIPHERTEXT_PREFIX)
        val sep = encoded.indexOf(':')
        if (sep <= 0 || sep >= encoded.length - 1) return null

        return runCatching {
            val ivBytes = Base64.decode(encoded.substring(0, sep), Base64.NO_WRAP)
            val cipherBytes = Base64.decode(encoded.substring(sep + 1), Base64.NO_WRAP)
            val secretKey = getOrCreateSecretKey()
            val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(GCM_TAG_LENGTH_BITS, ivBytes))
            val plainBytes = cipher.doFinal(cipherBytes)
            String(plainBytes, Charsets.UTF_8)
        }.getOrNull()
    }

    private fun getOrCreateSecretKey(): SecretKey = synchronized(keyLock) {
        if (hasAndroidKeyStoreProvider()) {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
            val existing = keyStore.getKey(KEYSTORE_ALIAS, null) as? SecretKey
            val resolved = existing ?: run {
                val generator = KeyGenerator.getInstance(
                    KeyProperties.KEY_ALGORITHM_AES,
                    ANDROID_KEYSTORE
                )
                val spec = KeyGenParameterSpec.Builder(
                    KEYSTORE_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(AES_KEY_SIZE_BITS)
                    .setRandomizedEncryptionRequired(true)
                    .build()
                generator.init(spec)
                generator.generateKey()
            }
            securityStatusTracker?.setKeystoreBacked(true)
            return@synchronized resolved
        }

        // Only reachable in pure JVM / Robolectric test environments where AndroidKeyStore does not exist
        securityStatusTracker?.setKeystoreBacked(false)
        jvmEphemeralTestKey ?: run {
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES)
            generator.init(AES_KEY_SIZE_BITS, SecureRandom())
            generator.generateKey().also { jvmEphemeralTestKey = it }
        }
    }

    private fun isKeyStoreBackedKey(): Boolean = hasAndroidKeyStoreProvider()

    private fun hasAndroidKeyStoreProvider(): Boolean =
        Security.getProvider(ANDROID_KEYSTORE) != null && context.packageName.isNotBlank()

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEYSTORE_ALIAS = "sonora_youtube_account_aes_key_v1"
        const val AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding"
        const val AES_KEY_SIZE_BITS = 256
        const val GCM_IV_LENGTH_BYTES = 12
        const val GCM_TAG_LENGTH_BITS = 128
        const val CIPHERTEXT_PREFIX = "enc:v1:"
    }
}
