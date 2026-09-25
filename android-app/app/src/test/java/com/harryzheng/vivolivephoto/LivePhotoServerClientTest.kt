package com.harryzheng.vivolivephoto

import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class LivePhotoServerClientTest {
    @Test
    fun `streams complete response to destination`() {
        val bytes = ByteArray(32 * 1024) { (it % 251).toByte() }
        val connection = object : HttpURLConnection(URL("http://example.test/media")) {
            override fun connect() = Unit
            override fun disconnect() = Unit
            override fun usingProxy() = false
            override fun getResponseCode() = 200
            override fun getInputStream() = ByteArrayInputStream(bytes)
        }
        val destination = File.createTempFile("livephoto-client", ".bin").apply { deleteOnExit() }
        val client = LivePhotoServerClient(ServerEndpoint.fromUserInput("http://example.test")) { connection }

        assertEquals(bytes.size.toLong(), client.download("/media", destination))
        assertArrayEquals(bytes, destination.readBytes())
        assertEquals(15_000, connection.connectTimeout)
        assertEquals(120_000, connection.readTimeout)
    }
}
