package com.harryzheng.vivolivephoto

import java.io.File
import java.security.MessageDigest

data class VerifiedLivePhotoDownload(
    val manifest: ServerLivePhotoManifest,
    val imageFile: File,
    val videoFile: File,
)

object DownloadedLivePhotoVerifier {
    fun verify(
        manifest: ServerLivePhotoManifest,
        imageFile: File,
        videoFile: File,
    ): VerifiedLivePhotoDownload {
        require(imageFile.length() == manifest.imageSize) { "Image size mismatch" }
        require(videoFile.length() == manifest.videoSize) { "Video size mismatch" }
        require(imageFile.sha256() == manifest.imageSha256) { "Image SHA-256 mismatch" }
        require(videoFile.sha256() == manifest.videoSha256) { "Video SHA-256 mismatch" }

        val imageId = imageFile.inputStream().use(VivoMetadataScanner::findLivePhotoId)
        val videoId = videoFile.inputStream().use(VivoMetadataScanner::findLivePhotoId)
        val videoHasMarker = videoFile.inputStream().use(VivoMetadataScanner::containsVivoMediaExtInfo)
        require(imageId == manifest.livePhotoId) { "Image Live Photo ID mismatch" }
        require(videoId == manifest.livePhotoId) { "Video Live Photo ID mismatch" }
        require(imageId == videoId) { "Live Photo IDs do not match" }
        require(videoHasMarker && manifest.videoHasVivoMediaExtInfo) { "MP4 missing vivoMediaExtInfo" }
        return VerifiedLivePhotoDownload(manifest, imageFile, videoFile)
    }
}

internal fun File.sha256(): String {
    val digest = MessageDigest.getInstance("SHA-256")
    inputStream().buffered().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count > 0) digest.update(buffer, 0, count)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}
