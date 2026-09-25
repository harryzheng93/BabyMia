package com.harryzheng.vivolivephoto

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerLivePhotoModelsTest {
    private val itemJson = """{
        "schemaVersion":1,
        "itemId":"11111111-1111-4111-8111-111111111111",
        "createdAt":"2026-09-20T12:00:00Z",
        "livePhotoId":"1789612876587fd1c83d00000000",
        "imageFilename":"IMG_1.jpg",
        "videoFilename":"IMG_1.mp4",
        "imageContentType":"image/jpeg",
        "videoContentType":"video/mp4",
        "imageSize":123,
        "videoSize":456,
        "imageSha256":"${"a".repeat(64)}",
        "videoSha256":"${"b".repeat(64)}",
        "videoHasVivoMediaExtInfo":true,
        "metadataUrl":"/api/live-photo/11111111-1111-4111-8111-111111111111",
        "imageUrl":"/api/live-photo/11111111-1111-4111-8111-111111111111/image",
        "videoUrl":"/api/live-photo/11111111-1111-4111-8111-111111111111/video",
        "galleryUrl":"/gallery"
    }"""

    @Test
    fun `parses schema one manifest and list`() {
        val item = ServerLivePhotoJson.parseManifest(itemJson)
        assertEquals("IMG_1.jpg", item.imageFilename)
        assertEquals("1789612876587fd1c83d00000000", item.livePhotoId)
        assertEquals("a".repeat(64), item.imageSha256)
        assertEquals(123L, item.imageSize)
        assertEquals("/gallery", item.galleryUrl)
        assertEquals(item, ServerLivePhotoJson.parseList("{\"items\":[$itemJson]}").single())
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects unsupported schema`() {
        ServerLivePhotoJson.parseManifest(itemJson.replace("\"schemaVersion\":1", "\"schemaVersion\":2"))
    }
}
