package com.harryzheng.vivolivephoto

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

class MainActivityConfigurationTest {
    @Test
    fun rotationDoesNotRecreateWebViewActivity() {
        val manifest = sequenceOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
        ).first { it.isFile }.readText()
        val activity = Regex(
            """<activity\s+.*?android:name="\.MainActivity".*?>""",
            RegexOption.DOT_MATCHES_ALL,
        ).find(manifest)?.value.orEmpty()
        val changes = Regex("""android:configChanges="([^"]+)"""")
            .find(activity)
            ?.groupValues
            ?.get(1)
            ?.split('|')
            ?.toSet()
            .orEmpty()

        assertTrue("MainActivity must handle orientation changes", "orientation" in changes)
        assertTrue("MainActivity must handle screen-size changes", "screenSize" in changes)
    }
}
