package com.example.core.security

import okhttp3.Interceptor
import okhttp3.Response
import javax.net.ssl.SSLPeerUnverifiedException

/**
 * Enforces HTTPS-only transport on every request and redirect hop in OkHttp.
 */
class HttpsOnlyInterceptor(
    private val securityStatusTracker: SecurityStatusTracker? = null
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (!request.url.isHttps) {
            securityStatusTracker?.recordBlockedInsecureConnection(request.url.toString())
            throw SSLPeerUnverifiedException(
                "Заблокировано незащищённое HTTP-соединение (${request.url.host})"
            )
        }
        return chain.proceed(request)
    }
}
