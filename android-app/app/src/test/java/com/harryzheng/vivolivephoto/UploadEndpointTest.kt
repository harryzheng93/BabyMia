package com.harryzheng.vivolivephoto

import org.junit.Assert.assertEquals
import org.junit.Test

class UploadEndpointTest {
    @Test
    fun `appends live photo API path to a server base URL`() {
        assertEquals(
            "http://192.168.1.10:8000/api/live-photo",
            UploadEndpoint.fromUserInput("http://192.168.1.10:8000")
        )
    }

    @Test
    fun `keeps an explicit live photo API endpoint`() {
        assertEquals(
            "http://192.168.1.10:8000/api/live-photo",
            UploadEndpoint.fromUserInput("http://192.168.1.10:8000/api/live-photo/")
        )
    }

    @Test
    fun `normalizes API endpoint through server endpoint`() {
        assertEquals(
            "https://example.test/api/live-photo",
            UploadEndpoint.fromUserInput("https://example.test/api/live-photo/")
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects non http endpoints`() {
        UploadEndpoint.fromUserInput("ftp://192.168.1.10/upload")
    }
}
