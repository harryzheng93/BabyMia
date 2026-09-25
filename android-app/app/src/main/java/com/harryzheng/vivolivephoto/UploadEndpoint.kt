package com.harryzheng.vivolivephoto

object UploadEndpoint {
    fun fromUserInput(input: String): String = ServerEndpoint.fromUserInput(input).uploadUrl
}
