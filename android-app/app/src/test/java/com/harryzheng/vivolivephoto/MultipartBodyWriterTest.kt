package com.harryzheng.vivolivephoto

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.charset.StandardCharsets

class MultipartBodyWriterTest {
    @Test
    fun `writes text and binary parts without altering file bytes`() {
        val boundary = "test-boundary"
        val imageBytes = byteArrayOf(0x00, 0x01, 0x7f, 0x80.toByte(), 0xff.toByte(), 0x0d, 0x0a)
        val videoBytes = byteArrayOf(0x66, 0x74, 0x79, 0x70, 0x00, 0xff.toByte(), 0x10)
        val output = ByteArrayOutputStream()

        MultipartBodyWriter(boundary, output).use { writer ->
            writer.writeText("livePhotoId", "1789612876587fd1c83d00000000")
            writer.writeFile("image", "IMG_1.jpg", "image/jpeg", ByteArrayInputStream(imageBytes))
            writer.writeFile("video", "IMG_1.mp4", "video/mp4", ByteArrayInputStream(videoBytes))
        }

        val body = output.toByteArray()
        val text = String(body, StandardCharsets.ISO_8859_1)

        assertTrue(text.contains("name=\"livePhotoId\""))
        assertTrue(text.contains("1789612876587fd1c83d00000000"))
        assertTrue(text.contains("name=\"image\"; filename=\"IMG_1.jpg\""))
        assertTrue(text.contains("Content-Type: image/jpeg"))
        assertTrue(text.contains("name=\"video\"; filename=\"IMG_1.mp4\""))
        assertTrue(text.contains("Content-Type: video/mp4"))
        assertTrue(text.endsWith("--$boundary--\r\n"))

        assertArrayEquals(imageBytes, body.sliceArray(findSequence(body, imageBytes) until findSequence(body, imageBytes) + imageBytes.size))
        assertArrayEquals(videoBytes, body.sliceArray(findSequence(body, videoBytes) until findSequence(body, videoBytes) + videoBytes.size))
    }

    private fun findSequence(haystack: ByteArray, needle: ByteArray): Int {
        for (start in 0..haystack.size - needle.size) {
            var matches = true
            for (i in needle.indices) {
                if (haystack[start + i] != needle[i]) {
                    matches = false
                    break
                }
            }
            if (matches) return start
        }
        throw AssertionError("sequence not found")
    }
}
