package com.harryzheng.vivolivephoto

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LivePhotoRestoreCoordinatorTest {
    @Test
    fun `restores pair in transactional order`() {
        val gateway = FakeGateway()
        val result = LivePhotoRestoreCoordinator(gateway).restore(verified())

        assertEquals(RestoreNames("IMG_1.jpg", "IMG_1.mp4"), result.names)
        assertEquals(
            listOf(
                "exists:IMAGE:IMG_1.jpg", "exists:VIDEO:IMG_1.mp4",
                "insert:IMAGE:IMG_1.jpg", "write:image", "insert:VIDEO:IMG_1.mp4", "write:video",
                "inspect:image", "inspect:video", "publish:image", "publish:video",
            ),
            gateway.events,
        )
    }

    @Test
    fun `second write failure deletes both rows`() {
        val gateway = FakeGateway(throwAt = "write:video")
        expectFailure(gateway)
        assertTrue(gateway.events.takeLast(2) == listOf("delete:video", "delete:image"))
    }

    @Test
    fun `post-write validation failure deletes both rows`() {
        val gateway = FakeGateway(invalidVideoInspection = true)
        expectFailure(gateway)
        assertTrue(gateway.events.takeLast(2) == listOf("delete:video", "delete:image"))
    }

    @Test
    fun `provider rename of one row fails and deletes both rows`() {
        val gateway = FakeGateway(actualVideoName = "IMG_1 (1).mp4")
        expectFailure(gateway)
        assertTrue(gateway.events.takeLast(2) == listOf("delete:video", "delete:image"))
    }

    @Test
    fun `second publish failure deletes published image and pending video`() {
        val gateway = FakeGateway(throwAt = "publish:video")
        expectFailure(gateway)
        assertTrue(gateway.events.contains("publish:image"))
        assertTrue(gateway.events.takeLast(2) == listOf("delete:video", "delete:image"))
    }

    private fun expectFailure(gateway: FakeGateway) {
        try {
            LivePhotoRestoreCoordinator(gateway).restore(verified())
            throw AssertionError("restore should fail")
        } catch (_: IllegalStateException) {
        } catch (_: IllegalArgumentException) {
        }
    }

    private fun verified(): VerifiedLivePhotoDownload {
        val manifest = ServerLivePhotoItem(
            1, "11111111-1111-4111-8111-111111111111", "now", LIVE_ID,
            "IMG_1.jpg", "IMG_1.mp4", "image/jpeg", "video/mp4", 1, 1,
            IMAGE_SHA, VIDEO_SHA, true, "/m", "/i", "/v", "/g",
        )
        return VerifiedLivePhotoDownload(manifest, File("image"), File("video"))
    }

    private class FakeGateway(
        private val throwAt: String? = null,
        private val invalidVideoInspection: Boolean = false,
        private val actualVideoName: String = "IMG_1.mp4",
    ) : RestoreMediaGateway {
        val events = mutableListOf<String>()

        override fun exists(kind: MediaKind, displayName: String, relativePath: String): Boolean {
            record("exists:$kind:$displayName")
            return false
        }

        override fun insertPending(
            kind: MediaKind,
            displayName: String,
            mimeType: String,
            relativePath: String,
        ): MediaRef {
            record("insert:$kind:$displayName")
            return MediaRef(if (kind == MediaKind.IMAGE) "image" else "video")
        }

        override fun write(ref: MediaRef, source: File) = record("write:${ref.uri}")

        override fun inspect(ref: MediaRef, kind: MediaKind): PostWriteMedia {
            record("inspect:${ref.uri}")
            return if (kind == MediaKind.IMAGE) {
                PostWriteMedia(IMAGE_SHA, LIVE_ID, false, "IMG_1.jpg", LivePhotoRestoreCoordinator.RELATIVE_PATH)
            } else {
                PostWriteMedia(
                    if (invalidVideoInspection) "0".repeat(64) else VIDEO_SHA,
                    LIVE_ID,
                    true,
                    actualVideoName,
                    LivePhotoRestoreCoordinator.RELATIVE_PATH,
                )
            }
        }

        override fun publish(ref: MediaRef) = record("publish:${ref.uri}")
        override fun delete(ref: MediaRef) = record("delete:${ref.uri}")

        private fun record(event: String) {
            events += event
            if (throwAt == event) throw IllegalStateException("failed at $event")
        }
    }

    companion object {
        private const val LIVE_ID = "1789612876587fd1c83d00000000"
        private val IMAGE_SHA = "a".repeat(64)
        private val VIDEO_SHA = "b".repeat(64)
    }
}
