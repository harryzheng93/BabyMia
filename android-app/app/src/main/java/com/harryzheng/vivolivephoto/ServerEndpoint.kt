package com.harryzheng.vivolivephoto

import java.net.URI
import java.net.URISyntaxException

data class ServerEndpoint(val baseUrl: String) {
    val uploadUrl: String = "$baseUrl/api/live-photo"
    val listUrl: String = "$baseUrl/api/live-photos"
    val galleryUrl: String = "$baseUrl/gallery"

    fun absolute(path: String): String {
        val uri = URI(path)
        return if (uri.isAbsolute) path else baseUrl + "/" + path.trimStart('/')
    }

    companion object {
        private const val API_PATH = "/api/live-photo"

        fun fromUserInput(input: String): ServerEndpoint {
            var normalized = input.trim().trimEnd('/')
            val uri = try {
                URI(normalized)
            } catch (failure: URISyntaxException) {
                throw IllegalArgumentException("服务器地址格式无效", failure)
            }
            require(uri.scheme == "http" || uri.scheme == "https") {
                "服务器地址必须以 http:// 或 https:// 开头"
            }
            require(!uri.host.isNullOrBlank()) { "服务器地址缺少主机名" }
            if (normalized.endsWith(API_PATH)) normalized = normalized.removeSuffix(API_PATH)
            return ServerEndpoint(normalized)
        }
    }
}
