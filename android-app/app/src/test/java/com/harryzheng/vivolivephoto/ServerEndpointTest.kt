package com.harryzheng.vivolivephoto

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerEndpointTest {
    @Test
    fun `derives endpoints from server root`() {
        val endpoint = ServerEndpoint.fromUserInput(" http://192.168.1.10:8000/ ")
        assertEquals("http://192.168.1.10:8000/api/live-photo", endpoint.uploadUrl)
        assertEquals("http://192.168.1.10:8000/api/live-photos", endpoint.listUrl)
        assertEquals("http://192.168.1.10:8000/gallery", endpoint.galleryUrl)
        assertEquals("http://192.168.1.10:8000/media", endpoint.absolute("/media"))
    }

    @Test
    fun `derives endpoints from upload API URL`() {
        val endpoint = ServerEndpoint.fromUserInput("http://192.168.1.10:8000/api/live-photo/")
        assertEquals("http://192.168.1.10:8000/api/live-photos", endpoint.listUrl)
        assertEquals("http://192.168.1.10:8000/gallery", endpoint.galleryUrl)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects non HTTP input`() {
        ServerEndpoint.fromUserInput("ftp://192.168.1.10")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects malformed URI as validation error`() {
        ServerEndpoint.fromUserInput("http://example.test/bad path")
    }
}
