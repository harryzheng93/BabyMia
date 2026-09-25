package com.harryzheng.vivolivephoto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream

class VivoMetadataScannerTest {
    @Test
    fun extractsValidLivePhotoId() {
        val id = "1789612876587fd1c83d00000000"
        val bytes = "prefix\"com.android.camera.livephoto\":\"$id\"suffix".toByteArray()

        assertEquals(id, VivoMetadataScanner.findLivePhotoId(ByteArrayInputStream(bytes)))
    }

    @Test
    fun ignoresInvalidLivePhotoId() {
        val bytes = "\"com.android.camera.livephoto\":\"not-an-id\"".toByteArray()

        assertNull(VivoMetadataScanner.findLivePhotoId(ByteArrayInputStream(bytes)))
    }

    @Test
    fun extractsIdSplitAcrossChunks() {
        val id = "1789612876587fd1c83d00000000"
        val padding = "x".repeat(4090)
        val bytes = (padding + "\"com.android.camera.livephoto\":\"$id\"").toByteArray()

        assertEquals(id, VivoMetadataScanner.findLivePhotoId(ByteArrayInputStream(bytes)))
    }

    @Test
    fun detectsVivoMediaExtInfoMarker() {
        val yes = ByteArrayInputStream("abc-vivoMediaExtInfo-xyz".toByteArray())
        val no = ByteArrayInputStream("abc-no-marker-xyz".toByteArray())

        assertTrue(VivoMetadataScanner.containsVivoMediaExtInfo(yes))
        assertFalse(VivoMetadataScanner.containsVivoMediaExtInfo(no))
    }
}
