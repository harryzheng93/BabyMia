package com.harryzheng.vivolivephoto

enum class MediaKind { IMAGE, VIDEO }

data class RestoreNames(val imageName: String, val videoName: String)

object RestoreNamePlanner {
    fun choose(
        imageFilename: String,
        videoFilename: String,
        exists: (MediaKind, String) -> Boolean,
    ): RestoreNames {
        require(imageFilename.isNotBlank() && videoFilename.isNotBlank()) { "Media filenames are required" }
        val imageStem = imageFilename.substringBeforeLast('.', imageFilename)
        var suffix = 0
        while (true) {
            val targetStem = if (suffix == 0) imageStem else "${imageStem}_restored_$suffix"
            val names = RestoreNames("$targetStem.jpg", "$targetStem.mp4")
            if (!exists(MediaKind.IMAGE, names.imageName) &&
                !exists(MediaKind.VIDEO, names.videoName)
            ) return names
            suffix++
        }
    }
}

data class PostWriteMedia(
    val sha256: String,
    val livePhotoId: String?,
    val hasVivoMediaExtInfo: Boolean,
    val displayName: String? = null,
    val relativePath: String? = null,
)

object RestoreValidation {
    fun requirePostWriteMatch(
        verified: VerifiedLivePhotoDownload,
        image: PostWriteMedia,
        video: PostWriteMedia,
        expectedNames: RestoreNames? = null,
        expectedRelativePath: String? = null,
    ) {
        val manifest = verified.manifest
        require(image.sha256 == manifest.imageSha256) { "Restored image SHA-256 mismatch" }
        require(video.sha256 == manifest.videoSha256) { "Restored video SHA-256 mismatch" }
        require(image.livePhotoId == manifest.livePhotoId) { "Restored image ID mismatch" }
        require(video.livePhotoId == manifest.livePhotoId) { "Restored video ID mismatch" }
        require(image.livePhotoId == video.livePhotoId) { "Restored IDs do not match" }
        require(video.hasVivoMediaExtInfo) { "Restored MP4 missing vivoMediaExtInfo" }
        if (expectedNames != null) {
            require(image.displayName == expectedNames.imageName) { "MediaStore renamed restored image" }
            require(video.displayName == expectedNames.videoName) { "MediaStore renamed restored video" }
        }
        if (expectedRelativePath != null) {
            val expectedPath = normalizedRelativePath(expectedRelativePath)
            require(image.relativePath?.let(::normalizedRelativePath) == expectedPath) { "Restored image path mismatch" }
            require(video.relativePath?.let(::normalizedRelativePath) == expectedPath) { "Restored video path mismatch" }
        }
    }

    private fun normalizedRelativePath(path: String): String = path
        .replace('\\', '/')
        .split('/')
        .filter(String::isNotEmpty)
        .joinToString("/")
        .lowercase()
}

object RestoreTempFiles {
    fun <T> withFiles(
        directory: java.io.File,
        creator: (String, String, java.io.File) -> java.io.File = java.io.File::createTempFile,
        block: (java.io.File, java.io.File) -> T,
    ): T {
        check((directory.isDirectory || directory.mkdirs()) && directory.isDirectory) {
            "无法创建恢复临时目录"
        }
        var image: java.io.File? = null
        var video: java.io.File? = null
        try {
            image = creator("image-", ".jpg", directory)
            video = creator("video-", ".mp4", directory)
            return block(image, video)
        } finally {
            image?.delete()
            video?.delete()
        }
    }
}

object RestoreDiagnostics {
    fun format(result: RestoreResult): String = buildString {
        appendLine("RESTORE_VALIDATED = TRUE")
        appendLine("image name: ${result.names.imageName}")
        appendLine("image uri: ${result.image.uri}")
        appendLine("image livePhotoId: ${result.imagePostWrite.livePhotoId}")
        appendLine("video name: ${result.names.videoName}")
        appendLine("video uri: ${result.video.uri}")
        appendLine("video livePhotoId: ${result.videoPostWrite.livePhotoId}")
        appendLine("vivoMediaExtInfo: ${result.videoPostWrite.hasVivoMediaExtInfo}")
        append("请在 vivo 相册中检查动态照片标识和按住播放；以上只证明公开 MediaStore 恢复后的字节与元数据校验通过。")
    }
}
