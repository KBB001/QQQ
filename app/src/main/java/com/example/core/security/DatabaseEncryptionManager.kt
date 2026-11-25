package com.example.core.security

import android.content.Context
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import com.example.data.repository.SecureAccountCipher
import dagger.hilt.android.qualifiers.ApplicationContext
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory
import java.io.File
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DatabaseEncryptionManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val cipher: SecureAccountCipher,
    private val securityStatusTracker: SecurityStatusTracker
) {
    private val lock = Any()

    fun createOpenHelperFactory(dbName: String): SupportSQLiteOpenHelper.Factory? = synchronized(lock) {
        val nativeLoaded = runCatching {
            System.loadLibrary("sqlcipher")
            true
        }.getOrDefault(false)

        if (!nativeLoaded) {
            securityStatusTracker.setDatabaseEncrypted(false)
            return null
        }

        val passphrase = getOrCreateDatabasePassphrase()
        val passphraseBytes = passphrase.toByteArray(Charsets.UTF_8)

        val dbFile = context.getDatabasePath(dbName)
        if (dbFile.exists() && isPlaintextSqliteFile(dbFile)) {
            val migrated = migratePlaintextDatabase(dbFile, passphrase, passphraseBytes)
            if (!migrated || isPlaintextSqliteFile(dbFile)) {
                securityStatusTracker.setDatabaseEncrypted(false)
                return null
            }
        }

        securityStatusTracker.setDatabaseEncrypted(true)
        return SupportOpenHelperFactory(passphraseBytes)
    }

    private fun getOrCreateDatabasePassphrase(): String {
        val prefs = context.getSharedPreferences(KEY_VAULT_PREFS, Context.MODE_PRIVATE)
        val encryptedStored = prefs.getString(KEY_DB_PASSPHRASE, null)
        if (!encryptedStored.isNullOrBlank()) {
            val decryptedHex = cipher.decrypt(encryptedStored)
            if (!decryptedHex.isNullOrBlank() &&
                decryptedHex.length == PASSPHRASE_BYTES * 2 &&
                decryptedHex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }
            ) {
                return decryptedHex.lowercase()
            }
        }
        val freshBytes = ByteArray(PASSPHRASE_BYTES).also { SecureRandom().nextBytes(it) }
        val freshHex = freshBytes.toHexString()
        prefs.edit().putString(KEY_DB_PASSPHRASE, cipher.encrypt(freshHex)).apply()
        return freshHex
    }

    private fun migratePlaintextDatabase(
        dbFile: File,
        passphrase: String,
        passphraseBytes: ByteArray
    ): Boolean {
        if (!dbFile.exists() || dbFile.length() < SQLITE_HEADER_MAGIC.size) return true
        if (!isPlaintextSqliteFile(dbFile)) return true

        val parentDir = dbFile.parentFile ?: return false
        parentDir.mkdirs()
        val tempEncrypted = File(parentDir, "${dbFile.name}.enc_tmp")
        val backupPlain = File(parentDir, "${dbFile.name}.plain_bak")
        val walFile = File("${dbFile.absolutePath}-wal")
        val shmFile = File("${dbFile.absolutePath}-shm")

        return runCatching {
            if (tempEncrypted.exists()) tempEncrypted.delete()
            if (backupPlain.exists()) backupPlain.delete()
            // Pre-create empty 0-byte target file so SQLite ATTACH always finds a writable path
            tempEncrypted.createNewFile()

            val plainDb = SQLiteDatabase.openDatabase(
                dbFile.absolutePath,
                null,
                SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY
            )
            var userVersion = 0
            try {
                runCatching { plainDb.rawExecSQL("PRAGMA wal_checkpoint(TRUNCATE);") }
                runCatching { plainDb.rawExecSQL("PRAGMA journal_mode=DELETE;") }
                userVersion = readUserVersion(plainDb)

                val escapedTempPath = tempEncrypted.absolutePath.replace("'", "''")
                val escapedPassphrase = passphrase.replace("'", "''")
                plainDb.rawExecSQL(
                    "ATTACH DATABASE '$escapedTempPath' AS encrypted KEY '$escapedPassphrase';"
                )
                plainDb.rawExecSQL("SELECT sqlcipher_export('encrypted');")
                if (userVersion > 0) {
                    plainDb.rawExecSQL("PRAGMA encrypted.user_version = $userVersion;")
                }
                plainDb.rawExecSQL("DETACH DATABASE encrypted;")
            } finally {
                runCatching { plainDb.close() }
            }

            if (!tempEncrypted.exists() ||
                tempEncrypted.length() <= 0L ||
                isPlaintextSqliteFile(tempEncrypted)
            ) {
                tempEncrypted.delete()
                return@runCatching false
            }

            if (userVersion > 0) {
                verifyEncryptedDatabaseReadable(tempEncrypted.name, passphraseBytes, userVersion)
                File("${tempEncrypted.absolutePath}-wal").delete()
                File("${tempEncrypted.absolutePath}-shm").delete()
                File("${tempEncrypted.absolutePath}-journal").delete()
            }

            if (dbFile.renameTo(backupPlain)) {
                if (tempEncrypted.renameTo(dbFile)) {
                    walFile.delete()
                    shmFile.delete()
                    File("${dbFile.absolutePath}-journal").delete()
                    backupPlain.delete()
                    true
                } else {
                    backupPlain.renameTo(dbFile)
                    tempEncrypted.delete()
                    false
                }
            } else {
                tempEncrypted.delete()
                false
            }
        }.onFailure {
            tempEncrypted.delete()
            if (!dbFile.exists() && backupPlain.exists()) {
                backupPlain.renameTo(dbFile)
            }
        }.getOrDefault(false)
    }

    private fun readUserVersion(db: SQLiteDatabase): Int {
        return runCatching {
            db.rawQuery("PRAGMA main.user_version;", null).use { cursor ->
                if (cursor.moveToFirst()) cursor.getInt(0) else 0
            }
        }.getOrDefault(0)
    }

    private fun verifyEncryptedDatabaseReadable(
        tempDbName: String,
        passphraseBytes: ByteArray,
        expectedVersion: Int
    ) {
        val factory = SupportOpenHelperFactory(passphraseBytes)
        val config = SupportSQLiteOpenHelper.Configuration.builder(context)
            .name(tempDbName)
            .callback(object : SupportSQLiteOpenHelper.Callback(expectedVersion) {
                override fun onCreate(db: SupportSQLiteDatabase) = Unit
                override fun onUpgrade(
                    db: SupportSQLiteDatabase,
                    oldVersion: Int,
                    newVersion: Int
                ) = Unit
            })
            .build()
        factory.create(config).use { helper ->
            helper.readableDatabase.query("SELECT COUNT(*) FROM sqlite_master;").use { cursor ->
                check(cursor.moveToFirst())
            }
        }
    }

    private fun isPlaintextSqliteFile(file: File): Boolean {
        val header = ByteArray(SQLITE_HEADER_MAGIC.size)
        val bytesRead = runCatching {
            file.inputStream().use { it.read(header) }
        }.getOrDefault(-1)
        return bytesRead == SQLITE_HEADER_MAGIC.size && header.contentEquals(SQLITE_HEADER_MAGIC)
    }

    private fun ByteArray.toHexString(): String = joinToString("") { "%02x".format(it) }

    private companion object {
        const val KEY_VAULT_PREFS = "sonora_db_key_vault"
        const val KEY_DB_PASSPHRASE = "db_master_key_v1"
        const val PASSPHRASE_BYTES = 32
        val SQLITE_HEADER_MAGIC = "SQLite format 3\u0000".toByteArray(Charsets.US_ASCII)
    }
}
