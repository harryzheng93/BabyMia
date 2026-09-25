package com.harryzheng.vivolivephoto

import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID

data class UploadResponse(
    val statusCode: Int,
    val body: String
)

class LivePhotoUploader(
    private val connectionFactory: (String) -> HttpURLConnection = { endpoint ->
        URL(endpoint).openConnection() as HttpURLConnection
    },
    private val boundaryFactory: () -> String = {
        "----vivo-live-photo-${UUID.randomUUID()}"
    }
) {
    fun upload(
        plan: LivePhotoUploadPlan,
        imageInput: InputStream,
        videoInput: InputStream,
        imageContentType: String = "image/jpeg",
        videoContentType: String = "video/mp4",
        cookie: String? = null,
        origin: String? = null,
        batchId: String = UUID.randomUUID().toString(),
        description: String = ""
    ): UploadResponse {
        val boundary = boundaryFactory()
        val connection = connectionFactory(plan.endpoint)

        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.useCaches = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 120_000
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            connection.setRequestProperty("Accept", "application/json, text/plain, */*")
            if (!cookie.isNullOrBlank()) connection.setRequestProperty("Cookie", cookie)
            if (!origin.isNullOrBlank()) connection.setRequestProperty("Origin", origin)
            connection.setChunkedStreamingMode(64 * 1024)

            connection.outputStream.use { output ->
                MultipartBodyWriter(boundary, output).use { writer ->
                    writer.writeText("livePhotoId", plan.livePhotoId)
                    writer.writeText("batchId", batchId)
                    writer.writeText("description", description.trim().take(500))
                    writer.writeFile(
                        name = "image",
                        fileName = plan.imageName,
                        contentType = imageContentType,
                        input = imageInput
                    )
                    writer.writeFile(
                        name = "video",
                        fileName = plan.videoName,
                        contentType = videoContentType,
                        input = videoInput
                    )
                }
            }

            val statusCode = connection.responseCode
            val responseStream = if (statusCode in 200..399) {
                connection.inputStream
            } else {
                connection.errorStream
            }
            val body = responseStream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty()

            return UploadResponse(statusCode, body)
        } finally {
            connection.disconnect()
        }
    }
}
