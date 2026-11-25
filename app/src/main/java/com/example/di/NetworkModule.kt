package com.example.di

import android.content.Context
import com.example.core.security.HttpsOnlyInterceptor
import com.example.core.security.SecurityStatusTracker
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.Cache
import okhttp3.ConnectionPool
import okhttp3.ConnectionSpec
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    private const val HTTP_CACHE_SIZE_BYTES = 20L * 1024L * 1024L

    @Provides
    @Singleton
    fun provideOkHttpClient(
        @ApplicationContext context: Context,
        securityStatusTracker: SecurityStatusTracker
    ): OkHttpClient {
        val cacheDir = File(context.cacheDir, "http_cache")
        val dispatcher = Dispatcher().apply {
            maxRequests = 32
            maxRequestsPerHost = 8
        }
        val httpsOnlyInterceptor = HttpsOnlyInterceptor(securityStatusTracker)
        return OkHttpClient.Builder()
            .cache(Cache(cacheDir, HTTP_CACHE_SIZE_BYTES))
            .connectionPool(ConnectionPool(8, 5, TimeUnit.MINUTES))
            .dispatcher(dispatcher)
            .connectionSpecs(listOf(ConnectionSpec.RESTRICTED_TLS, ConnectionSpec.MODERN_TLS))
            .addInterceptor(httpsOnlyInterceptor)
            .addNetworkInterceptor(httpsOnlyInterceptor)
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .callTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .followRedirects(true)
            .followSslRedirects(false)
            .build()
    }
}
