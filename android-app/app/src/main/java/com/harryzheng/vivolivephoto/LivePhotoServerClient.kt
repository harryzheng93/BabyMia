package com.harryzheng.vivolivephoto

import java.io.File
import java.net.HttpURLConnection
import java.net.URL

class LivePhotoServerClient(
    private val endpoint: ServerEndpoint,
    private val cookie: String? = null,
    private val origin: String? = null,
    private val connectionFactory: (String) -> HttpURLConnection = {
        URL(it).openConnection() as HttpURLConnection
    },
) {
    fun list(): List<ServerLivePhotoItem> = ServerLivePhotoJson.parseList(getText(endpoint.listUrl))

    fun manifest(itemId: String): ServerLivePhotoManifest =
        ServerLivePhotoJson.parseManifest(getText(endpoint.absolute("/api/live-photo/$itemId")))

    fun download(path: String, destination: File): Long {
        val connection = open(endpoint.absolute(path))
        try {
            requireSuccess(connection)
            connection.inputStream.use { input ->
                destination.outputStream().use { output -> input.copyTo(output, 64 * 1024) }
            }
            return destination.length()
        } finally {
            connection.disconnect()
        }
    }

    private fun getText(url: String): String {
        val connection = open(url)
        try {
            requireSuccess(connection)
            return connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun open(url: String): HttpURLConnection = connectionFactory(url).apply {
        requestMethod = "GET"
        connectTimeout = 15_000
        readTimeout = 120_000
        if (!cookie.isNullOrBlank()) setRequestProperty("Cookie", cookie)
        if (!origin.isNullOrBlank()) setRequestProperty("Origin", origin)
    }

    private fun requireSuccess(connection: HttpURLConnection) {
        val code = connection.responseCode
        if (code !in 200..299) throw IllegalStateException("HTTP $code")
    }
}
