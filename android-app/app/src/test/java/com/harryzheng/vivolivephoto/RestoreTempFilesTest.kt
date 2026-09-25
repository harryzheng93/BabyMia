package com.harryzheng.vivolivephoto

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RestoreTempFilesTest {
    @Test
    fun `cleans first file when second creation fails`() {
        val directory = Files.createTempDirectory("restore-temp-test").toFile()
        var first: File? = null
        var blockRan = false
        try {
            RestoreTempFiles.withFiles(directory, creator = { prefix, suffix, parent ->
                if (first == null) File.createTempFile(prefix, suffix, parent).also { first = it }
                else throw IllegalStateException("disk full")
            }) { _, _ -> blockRan = true }
            fail("creation should fail")
        } catch (_: IllegalStateException) {
            assertFalse(first?.exists() ?: true)
            assertFalse(blockRan)
        } finally {
            directory.deleteRecursively()
        }
    }

    @Test
    fun `cleans both files after successful block`() {
        val directory = Files.createTempDirectory("restore-temp-test").toFile()
        var image: File? = null
        var video: File? = null
        try {
            RestoreTempFiles.withFiles(directory) { imageFile, videoFile ->
                image = imageFile
                video = videoFile
                assertTrue(imageFile.exists() && videoFile.exists())
            }
            assertFalse(image?.exists() ?: true)
            assertFalse(video?.exists() ?: true)
        } finally {
            directory.deleteRecursively()
        }
    }
}
