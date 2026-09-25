package com.harryzheng.vivolivephoto

import org.junit.Assert.assertEquals
import org.junit.Test

class LivePhotoUploadPlanTest {
    @Test
    fun `creates plan only for matching live photo IDs`() {
        val id = "1789612876587fd1c83d00000000"
        val plan = LivePhotoUploadPlan.create(
            serverInput = "http://10.0.0.2:8000",
            imageName = "IMG_1.jpg",
            videoName = "IMG_1.mp4",
            imageLivePhotoId = id,
            videoLivePhotoId = id
        )

        assertEquals("http://10.0.0.2:8000/api/live-photo", plan.endpoint)
        assertEquals(id, plan.livePhotoId)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects mismatched live photo IDs`() {
        LivePhotoUploadPlan.create(
            serverInput = "http://10.0.0.2:8000",
            imageName = "IMG_1.jpg",
            videoName = "IMG_1.mp4",
            imageLivePhotoId = "1789612876587fd1c83d00000000",
            videoLivePhotoId = "1789612876587fd1c83d00000001"
        )
    }
}
