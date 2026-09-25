package com.harryzheng.vivolivephoto

import org.json.JSONObject

data class ServerLivePhotoItem(
    val schemaVersion: Int,
    val itemId: String,
    val createdAt: String,
    val livePhotoId: String,
    val imageFilename: String,
    val videoFilename: String,
    val imageContentType: String,
    val videoContentType: String,
    val imageSize: Long,
    val videoSize: Long,
    val imageSha256: String,
    val videoSha256: String,
    val videoHasVivoMediaExtInfo: Boolean,
    val metadataUrl: String,
    val imageUrl: String,
    val videoUrl: String,
    val galleryUrl: String,
)

typealias ServerLivePhotoManifest = ServerLivePhotoItem

object ServerLivePhotoJson {
    private val livePhotoIdPattern = Regex("[0-9a-f]{28}")
    private val sha256Pattern = Regex("[0-9a-f]{64}")

    fun parseList(json: String): List<ServerLivePhotoItem> {
        val items = JSONObject(json).getJSONArray("items")
        return (0 until items.length()).map { parse(items.getJSONObject(it)) }
    }

    fun parseManifest(json: String): ServerLivePhotoManifest = parse(JSONObject(json))

    private fun parse(value: JSONObject): ServerLivePhotoItem {
        val schemaVersion = value.getInt("schemaVersion")
        require(schemaVersion == 1) { "Unsupported schemaVersion: $schemaVersion" }
        val livePhotoId = value.getString("livePhotoId")
        val imageSha256 = value.getString("imageSha256").lowercase()
        val videoSha256 = value.getString("videoSha256").lowercase()
        val imageSize = value.getLong("imageSize")
        val videoSize = value.getLong("videoSize")
        require(livePhotoIdPattern.matches(livePhotoId)) { "Invalid Live Photo ID" }
        require(sha256Pattern.matches(imageSha256) && sha256Pattern.matches(videoSha256)) {
            "Invalid SHA-256"
        }
        require(imageSize >= 0 && videoSize >= 0) { "Invalid media size" }
        return ServerLivePhotoItem(
            schemaVersion = schemaVersion,
            itemId = value.getString("itemId"),
            createdAt = value.getString("createdAt"),
            livePhotoId = livePhotoId,
            imageFilename = value.getString("imageFilename"),
            videoFilename = value.getString("videoFilename"),
            imageContentType = value.getString("imageContentType"),
            videoContentType = value.getString("videoContentType"),
            imageSize = imageSize,
            videoSize = videoSize,
            imageSha256 = imageSha256,
            videoSha256 = videoSha256,
            videoHasVivoMediaExtInfo = value.getBoolean("videoHasVivoMediaExtInfo"),
            metadataUrl = value.getString("metadataUrl"),
            imageUrl = value.getString("imageUrl"),
            videoUrl = value.getString("videoUrl"),
            galleryUrl = value.getString("galleryUrl"),
        )
    }
}
