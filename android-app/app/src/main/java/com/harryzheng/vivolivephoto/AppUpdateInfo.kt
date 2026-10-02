package com.harryzheng.vivolivephoto

import org.json.JSONObject

data class AppUpdateInfo(
    val versionName: String,
    val versionCode: Int,
    val releaseNotes: String,
    val downloadUrl: String,
    val size: Long,
) {
    companion object {
        fun availableFrom(json: String, currentVersionCode: Int): AppUpdateInfo? {
            val root = JSONObject(json)
            if (!root.optBoolean("available")) return null
            val latest = root.optJSONObject("latest") ?: return null
            val versionCode = latest.optInt("versionCode")
            val versionName = latest.optString("versionName").trim()
            val downloadUrl = latest.optString("downloadUrl").trim()
            if (versionCode <= currentVersionCode || versionName.isBlank() || downloadUrl.isBlank()) return null
            return AppUpdateInfo(
                versionName = versionName,
                versionCode = versionCode,
                releaseNotes = latest.optString("releaseNotes").trim(),
                downloadUrl = downloadUrl,
                size = latest.optLong("size").coerceAtLeast(0),
            )
        }
    }
}

