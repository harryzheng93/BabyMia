package com.harryzheng.vivolivephoto

import java.io.InputStream
import java.nio.charset.StandardCharsets

object VivoMetadataScanner {
    private const val CHUNK_SIZE = 4096
    private const val OVERLAP = 512
    private const val VIVO_MEDIA_MARKER = "vivoMediaExtInfo"

    private val livePhotoIdRegex = Regex(
        """[\"]?com\.android\.camera\.livephoto[\"]?\s*[:=]\s*[\"]?([0-9a-f]{28})[\"]?"""
    )

    fun findLivePhotoId(input: InputStream): String? = input.use { stream ->
        scanText(stream) { text ->
            livePhotoIdRegex.find(text)?.groupValues?.get(1)
        }
    }

    fun containsVivoMediaExtInfo(input: InputStream): Boolean = input.use { stream ->
        scanText(stream) { text ->
            if (text.contains(VIVO_MEDIA_MARKER)) true else null
        } ?: false
    }

    private fun <T> scanText(input: InputStream, matcher: (String) -> T?): T? {
        val buffer = ByteArray(CHUNK_SIZE)
        var tail = ByteArray(0)

        while (true) {
            val read = input.read(buffer)
            if (read < 0) return null
            if (read == 0) continue

            val combined = ByteArray(tail.size + read)
            tail.copyInto(combined)
            buffer.copyInto(combined, destinationOffset = tail.size, endIndex = read)

            val text = String(combined, StandardCharsets.ISO_8859_1)
            matcher(text)?.let { return it }

            val keep = minOf(OVERLAP, combined.size)
            tail = combined.copyOfRange(combined.size - keep, combined.size)
        }
    }
}
