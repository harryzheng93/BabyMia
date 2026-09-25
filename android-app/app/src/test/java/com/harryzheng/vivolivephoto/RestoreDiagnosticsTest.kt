package com.harryzheng.vivolivephoto

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RestoreDiagnosticsTest {
    @Test
    fun `reports validated restore without claiming vivo Gallery recognition`() {
        val result = RestoreResult(
            MediaRef("content://image/1"),
            MediaRef("content://video/2"),
            RestoreNames("IMG_1_restored_1.jpg", "IMG_1_restored_1.mp4"),
            PostWriteMedia("a".repeat(64), LIVE_ID, false),
            PostWriteMedia("b".repeat(64), LIVE_ID, true),
        )

        val text = RestoreDiagnostics.format(result)

        assertTrue(text.contains("RESTORE_VALIDATED = TRUE"))
        assertTrue(text.contains("IMG_1_restored_1.jpg"))
        assertTrue(text.contains("IMG_1_restored_1.mp4"))
        assertTrue(text.contains("image livePhotoId: $LIVE_ID"))
        assertTrue(text.contains("video livePhotoId: $LIVE_ID"))
        assertTrue(text.contains("vivoMediaExtInfo: true"))
        assertTrue(text.contains("请在 vivo 相册中检查动态照片标识和按住播放"))
        assertFalse(text.contains("vivo 相册识别成功"))
    }

    companion object {
        private const val LIVE_ID = "1789612876587fd1c83d00000000"
    }
}
