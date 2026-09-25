package com.harryzheng.vivolivephoto

import java.io.File
import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadedLivePhotoVerifierTest {
    private val liveId = "1789612876587fd1c83d00000000"
    private val imageBytes = "JPEG com.android.camera.livephoto:$liveId".toByteArray()
    private val videoBytes = "MP4 vivoMediaExtInfo com.android.camera.livephoto:$liveId".toByteArray()

    @Test
    fun `accepts exact pair`() {
        withFiles(imageBytes, videoBytes) { image, video ->
            val verified = DownloadedLivePhotoVerifier.verify(manifest(), image, video)
            assertEquals(image, verified.imageFile)
            assertEquals(video, verified.videoFile)
            assertEquals(liveId, verified.manifest.livePhotoId)
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects modified image SHA`() = withFiles(imageBytes.copyOf().apply { this[0] = 'X'.code.toByte() }, videoBytes) { image, video ->
        DownloadedLivePhotoVerifier.verify(manifest(), image, video)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects modified video SHA`() = withFiles(imageBytes, videoBytes.copyOf().apply { this[0] = 'X'.code.toByte() }) { image, video ->
        DownloadedLivePhotoVerifier.verify(manifest(), image, video)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects video without vivo marker even when hash and ID match`() {
        val markerless = "MP4 com.android.camera.livephoto:$liveId".toByteArray()
        withFiles(imageBytes, markerless) { image, video ->
            DownloadedLivePhotoVerifier.verify(manifest(video = markerless), image, video)
        }
    }

    private fun manifest(video: ByteArray = videoBytes) = ServerLivePhotoItem(
        1, "11111111-1111-4111-8111-111111111111", "2026-09-20T12:00:00Z", liveId,
        "IMG_1.jpg", "IMG_1.mp4", "image/jpeg", "video/mp4",
        imageBytes.size.toLong(), video.size.toLong(), sha(imageBytes), sha(video), true,
        "/metadata", "/image", "/video", "/gallery",
    )

    private fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }

    private fun withFiles(imageBytes: ByteArray, videoBytes: ByteArray, block: (File, File) -> Unit) {
        val image = File.createTempFile("downloaded-live-photo", ".jpg")
        val video = File.createTempFile("downloaded-live-photo", ".mp4")
        try {
            image.writeBytes(imageBytes)
            video.writeBytes(videoBytes)
            block(image, video)
        } finally {
            image.delete()
            video.delete()
        }
    }
}
