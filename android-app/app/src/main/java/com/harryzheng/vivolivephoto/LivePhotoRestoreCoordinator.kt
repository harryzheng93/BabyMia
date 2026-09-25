package com.harryzheng.vivolivephoto

import java.io.File

data class MediaRef(val uri: String)

data class RestoreResult(
    val image: MediaRef,
    val video: MediaRef,
    val names: RestoreNames,
    val imagePostWrite: PostWriteMedia,
    val videoPostWrite: PostWriteMedia,
)

interface RestoreMediaGateway {
    fun exists(kind: MediaKind, displayName: String, relativePath: String): Boolean
    fun insertPending(kind: MediaKind, displayName: String, mimeType: String, relativePath: String): MediaRef
    fun write(ref: MediaRef, source: File)
    fun inspect(ref: MediaRef, kind: MediaKind): PostWriteMedia
    fun publish(ref: MediaRef)
    fun delete(ref: MediaRef)
}

class LivePhotoRestoreCoordinator(private val gateway: RestoreMediaGateway) {
    fun restore(verified: VerifiedLivePhotoDownload): RestoreResult {
        val manifest = verified.manifest
        val names = RestoreNamePlanner.choose(manifest.imageFilename, manifest.videoFilename) { kind, name ->
            gateway.exists(kind, name, RELATIVE_PATH)
        }
        val created = mutableListOf<MediaRef>()
        try {
            val image = gateway.insertPending(
                MediaKind.IMAGE, names.imageName, manifest.imageContentType, RELATIVE_PATH,
            ).also(created::add)
            gateway.write(image, verified.imageFile)

            val video = gateway.insertPending(
                MediaKind.VIDEO, names.videoName, manifest.videoContentType, RELATIVE_PATH,
            ).also(created::add)
            gateway.write(video, verified.videoFile)

            val imagePostWrite = gateway.inspect(image, MediaKind.IMAGE)
            val videoPostWrite = gateway.inspect(video, MediaKind.VIDEO)
            RestoreValidation.requirePostWriteMatch(
                verified,
                imagePostWrite,
                videoPostWrite,
                names,
                RELATIVE_PATH,
            )
            gateway.publish(image)
            gateway.publish(video)
            return RestoreResult(image, video, names, imagePostWrite, videoPostWrite)
        } catch (failure: Throwable) {
            created.asReversed().forEach { ref ->
                try {
                    gateway.delete(ref)
                } catch (_: Throwable) {
                }
            }
            throw failure
        }
    }

    companion object {
        const val RELATIVE_PATH = "DCIM/Camera/"
    }
}
