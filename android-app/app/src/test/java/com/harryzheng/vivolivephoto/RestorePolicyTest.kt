package com.harryzheng.vivolivephoto

import org.junit.Assert.assertEquals
import org.junit.Test

class RestorePolicyTest {
    @Test
    fun `keeps free paired names`() {
        assertEquals(
            RestoreNames("IMG_1.jpg", "IMG_1.mp4"),
            RestoreNamePlanner.choose("IMG_1.jpg", "IMG_1.mp4") { _, _ -> false },
        )
    }

    @Test
    fun `video-only collision suffixes both names`() {
        val names = RestoreNamePlanner.choose("IMG_1.jpg", "IMG_1.mp4") { kind, name ->
            kind == MediaKind.VIDEO && name == "IMG_1.mp4"
        }
        assertEquals(RestoreNames("IMG_1_restored_1.jpg", "IMG_1_restored_1.mp4"), names)
    }

    @Test
    fun `collision on first suffix advances both names`() {
        val names = RestoreNamePlanner.choose("IMG_1.jpg", "IMG_1.mp4") { _, name ->
            name == "IMG_1.jpg" || name == "IMG_1_restored_1.jpg"
        }
        assertEquals(RestoreNames("IMG_1_restored_2.jpg", "IMG_1_restored_2.mp4"), names)
    }

    @Test
    fun `mismatched stems use image stem for both`() {
        val names = RestoreNamePlanner.choose("PHOTO.jpg", "OTHER.mp4") { _, _ -> false }
        assertEquals(RestoreNames("PHOTO.jpg", "PHOTO.mp4"), names)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `post-write mismatch is rejected`() {
        val manifest = testManifest()
        val verified = VerifiedLivePhotoDownload(manifest, java.io.File("image"), java.io.File("video"))
        RestoreValidation.requirePostWriteMatch(
            verified,
            PostWriteMedia(manifest.imageSha256, manifest.livePhotoId, false),
            PostWriteMedia(manifest.videoSha256, manifest.livePhotoId, false),
        )
    }

    @Test
    fun `accepts equivalent MediaStore path without trailing separator`() {
        val manifest = testManifest()
        val verified = VerifiedLivePhotoDownload(manifest, java.io.File("image"), java.io.File("video"))
        RestoreValidation.requirePostWriteMatch(
            verified,
            PostWriteMedia(manifest.imageSha256, manifest.livePhotoId, false, "IMG_1.jpg", "DCIM/Camera"),
            PostWriteMedia(manifest.videoSha256, manifest.livePhotoId, true, "IMG_1.mp4", "DCIM/Camera"),
            RestoreNames("IMG_1.jpg", "IMG_1.mp4"),
            "DCIM/Camera/",
        )
    }
    private fun testManifest() = ServerLivePhotoItem(
        1, "11111111-1111-4111-8111-111111111111", "now", "1789612876587fd1c83d00000000",
        "IMG_1.jpg", "IMG_1.mp4", "image/jpeg", "video/mp4", 1, 1,
        "a".repeat(64), "b".repeat(64), true, "/m", "/i", "/v", "/g",
    )
}
