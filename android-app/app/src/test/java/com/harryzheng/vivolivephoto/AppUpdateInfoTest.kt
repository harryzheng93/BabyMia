package com.harryzheng.vivolivephoto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppUpdateInfoTest {
    @Test
    fun returnsNewerVersionFromServerResponse() {
        val update = AppUpdateInfo.availableFrom(
            """{"available":true,"latest":{"versionName":"3.12","versionCode":12,"releaseNotes":"修复问题","downloadUrl":"/api/app-update/apk","size":2048}}""",
            currentVersionCode = 11,
        )

        assertEquals("3.12", update?.versionName)
        assertEquals(12, update?.versionCode)
        assertEquals("修复问题", update?.releaseNotes)
    }

    @Test
    fun ignoresCurrentOrOlderVersion() {
        val response = """{"available":true,"latest":{"versionName":"3.11","versionCode":11,"downloadUrl":"/api/app-update/apk"}}"""
        assertNull(AppUpdateInfo.availableFrom(response, currentVersionCode = 11))
    }
}

