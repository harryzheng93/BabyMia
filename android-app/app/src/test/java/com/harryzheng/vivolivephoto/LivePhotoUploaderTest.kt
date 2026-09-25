package com.harryzheng.vivolivephoto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

class LivePhotoUploaderTest {
    @Test
    fun `posts multipart image video and live photo id and returns response`() {
        val endpoint = "http://10.0.0.2:8000/api/live-photo"
        val connection = FakeHttpURLConnection(URL(endpoint), 200, "{\"success\":true}")
        val uploader = LivePhotoUploader(
            connectionFactory = { connection },
            boundaryFactory = { "test-boundary" }
        )
        val plan = LivePhotoUploadPlan(
            endpoint = endpoint,
            imageName = "IMG_1.jpg",
            videoName = "IMG_1.mp4",
            livePhotoId = "1789612876587fd1c83d00000000"
        )

        val response = uploader.upload(
            plan = plan,
            imageInput = ByteArrayInputStream(byteArrayOf(0x01, 0x02, 0x03)),
            videoInput = ByteArrayInputStream(byteArrayOf(0x66, 0x74, 0x79, 0x70)),
            batchId = "timeline-batch-1",
            description = "第一次看见雨"
        )

        assertEquals("POST", connection.requestMethod)
        assertTrue(connection.doOutput)
        assertEquals(
            "multipart/form-data; boundary=test-boundary",
            connection.requestProperties["Content-Type"]?.single()
        )
        val sent = String(connection.sent.toByteArray(), StandardCharsets.UTF_8)
        assertTrue(sent.contains("name=\"livePhotoId\""))
        assertTrue(sent.contains("1789612876587fd1c83d00000000"))
        assertTrue(sent.contains("name=\"batchId\""))
        assertTrue(sent.contains("timeline-batch-1"))
        assertTrue(sent.contains("name=\"description\""))
        assertTrue(sent.contains("第一次看见雨"))
        assertTrue(sent.contains("filename=\"IMG_1.jpg\""))
        assertTrue(sent.contains("filename=\"IMG_1.mp4\""))
        assertEquals(200, response.statusCode)
        assertEquals("{\"success\":true}", response.body)
    }

    private class FakeHttpURLConnection(
        url: URL,
        private val fakeCode: Int,
        private val fakeBody: String
    ) : HttpURLConnection(url) {
        val sent = ByteArrayOutputStream()

        override fun connect() = Unit
        override fun disconnect() = Unit
        override fun usingProxy(): Boolean = false
        override fun getOutputStream(): ByteArrayOutputStream = sent
        override fun getResponseCode(): Int = fakeCode
        override fun getInputStream(): InputStream =
            ByteArrayInputStream(fakeBody.toByteArray(StandardCharsets.UTF_8))
    }
}

