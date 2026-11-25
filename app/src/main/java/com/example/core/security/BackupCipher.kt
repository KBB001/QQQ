package com.example.core.security

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

@Serializable
data class EncryptedBackupEnvelope(
    val format: String = FORMAT_V1,
    val kdf: String = KDF_PBKDF2_SHA256,
    val iterations: Int = PBKDF2_ITERATIONS,
    val salt: String,
    val iv: String,
    val ciphertext: String
) {
    companion object {
        const val FORMAT_V1 = "sonora-enc:v1"
        const val KDF_PBKDF2_SHA256 = "PBKDF2WithHmacSHA256"
        const val PBKDF2_ITERATIONS = 120_000
    }
}

object BackupCipher {
    private const val SALT_BYTES = 16
    private const val IV_BYTES = 12
    private const val KEY_BITS = 256
    private const val TAG_BITS = 128
    private const val AES_GCM = "AES/GCM/NoPadding"
    private const val MIN_ITERATIONS = 50_000
    private const val MAX_ITERATIONS = 500_000

    private val jsonCodec = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun isEncryptedBackup(rawContent: String?): Boolean {
        if (rawContent.isNullOrBlank()) return false
        val trimmed = rawContent.trim()
        if (!trimmed.startsWith("{")) return false
        return runCatching {
            val env = jsonCodec.decodeFromString<EncryptedBackupEnvelope>(trimmed)
            env.format == EncryptedBackupEnvelope.FORMAT_V1 &&
                env.salt.isNotBlank() &&
                env.iv.isNotBlank() &&
                env.ciphertext.isNotBlank()
        }.getOrDefault(false)
    }

    fun encrypt(plaintextJson: String, password: String): String {
        val cleanPassword = password.toCharArray()
        require(cleanPassword.size >= 6) {
            "Пароль резервной копии должен содержать не менее 6 символов"
        }
        val random = SecureRandom()
        val salt = ByteArray(SALT_BYTES).also { random.nextBytes(it) }
        val iv = ByteArray(IV_BYTES).also { random.nextBytes(it) }
        try {
            val secretKey = deriveAesKey(cleanPassword, salt, EncryptedBackupEnvelope.PBKDF2_ITERATIONS)
            val cipher = Cipher.getInstance(AES_GCM)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey, GCMParameterSpec(TAG_BITS, iv))
            val encrypted = cipher.doFinal(plaintextJson.toByteArray(Charsets.UTF_8))

            val envelope = EncryptedBackupEnvelope(
                salt = Base64.getEncoder().encodeToString(salt),
                iv = Base64.getEncoder().encodeToString(iv),
                ciphertext = Base64.getEncoder().encodeToString(encrypted)
            )
            return jsonCodec.encodeToString(envelope)
        } finally {
            cleanPassword.fill('\u0000')
        }
    }

    fun decrypt(encryptedPayload: String, password: String): Result<String> = runCatching {
        val cleanPassword = password.toCharArray()
        require(cleanPassword.isNotEmpty()) { "Введите пароль для расшифровки" }
        try {
            val envelope = jsonCodec.decodeFromString<EncryptedBackupEnvelope>(encryptedPayload.trim())
            require(envelope.format == EncryptedBackupEnvelope.FORMAT_V1) {
                "Неподдерживаемый формат зашифрованной копии"
            }
            require(envelope.kdf == EncryptedBackupEnvelope.KDF_PBKDF2_SHA256) {
                "Неподдерживаемый алгоритм KDF"
            }
            require(envelope.iterations in MIN_ITERATIONS..MAX_ITERATIONS) {
                "Некорректные параметры шифрования"
            }
            val salt = Base64.getDecoder().decode(envelope.salt)
            val iv = Base64.getDecoder().decode(envelope.iv)
            val cipherBytes = Base64.getDecoder().decode(envelope.ciphertext)

            val secretKey = deriveAesKey(cleanPassword, salt, envelope.iterations)
            val cipher = Cipher.getInstance(AES_GCM)
            cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(TAG_BITS, iv))
            val plainBytes = cipher.doFinal(cipherBytes)
            String(plainBytes, Charsets.UTF_8)
        } finally {
            cleanPassword.fill('\u0000')
        }
    }

    private fun deriveAesKey(
        password: CharArray,
        salt: ByteArray,
        iterations: Int
    ): SecretKeySpec {
        val spec = PBEKeySpec(password, salt, iterations, KEY_BITS)
        try {
            val factory = SecretKeyFactory.getInstance(EncryptedBackupEnvelope.KDF_PBKDF2_SHA256)
            val keyBytes = factory.generateSecret(spec).encoded
            return SecretKeySpec(keyBytes, "AES")
        } finally {
            spec.clearPassword()
        }
    }
}
