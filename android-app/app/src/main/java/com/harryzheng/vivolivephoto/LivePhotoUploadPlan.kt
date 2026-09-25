package com.harryzheng.vivolivephoto

data class LivePhotoUploadPlan(
    val endpoint: String,
    val imageName: String,
    val videoName: String,
    val livePhotoId: String
) {
    companion object {
        fun create(
            serverInput: String,
            imageName: String,
            videoName: String,
            imageLivePhotoId: String?,
            videoLivePhotoId: String?
        ): LivePhotoUploadPlan {
            require(!imageLivePhotoId.isNullOrBlank()) { "JPG 未解析到 Live Photo ID" }
            require(!videoLivePhotoId.isNullOrBlank()) { "MP4 未解析到 Live Photo ID" }
            require(imageLivePhotoId == videoLivePhotoId) { "JPG 与 MP4 的 Live Photo ID 不一致" }

            return LivePhotoUploadPlan(
                endpoint = UploadEndpoint.fromUserInput(serverInput),
                imageName = imageName,
                videoName = videoName,
                livePhotoId = imageLivePhotoId
            )
        }
    }
}
