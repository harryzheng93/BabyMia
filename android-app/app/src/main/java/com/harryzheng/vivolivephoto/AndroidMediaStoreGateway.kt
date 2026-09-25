package com.harryzheng.vivolivephoto

import android.content.ContentResolver
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

@RequiresApi(Build.VERSION_CODES.Q)
class AndroidMediaStoreGateway(private val resolver: ContentResolver) : RestoreMediaGateway {
    override fun exists(kind: MediaKind, displayName: String, relativePath: String): Boolean =
        resolver.query(
            collection(kind),
            arrayOf(MediaStore.MediaColumns._ID),
            "${MediaStore.MediaColumns.DISPLAY_NAME} = ? AND ${MediaStore.MediaColumns.RELATIVE_PATH} = ?",
            arrayOf(displayName, relativePath),
            null,
        )?.use { it.moveToFirst() } ?: false

    override fun insertPending(
        kind: MediaKind,
        displayName: String,
        mimeType: String,
        relativePath: String,
    ): MediaRef {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = requireNotNull(resolver.insert(collection(kind), values)) {
            "MediaStore insert returned null"
        }
        return MediaRef(uri.toString())
    }

    override fun write(ref: MediaRef, source: File) {
        val uri = Uri.parse(ref.uri)
        requireNotNull(resolver.openOutputStream(uri, "w")) { "Cannot open MediaStore output" }.use { output ->
            source.inputStream().use { input -> input.copyTo(output, 64 * 1024) }
        }
    }

    override fun inspect(ref: MediaRef, kind: MediaKind): PostWriteMedia {
        val uri = Uri.parse(ref.uri)
        val mediaIdentity = resolver.query(
            uri,
            arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.RELATIVE_PATH),
            null,
            null,
            null,
        )?.use { cursor ->
            check(cursor.moveToFirst()) { "Cannot query restored MediaStore row" }
            cursor.getString(0) to cursor.getString(1)
        } ?: error("Cannot query restored MediaStore row")
        val digest = requireNotNull(resolver.openInputStream(uri)) { "Cannot reopen MediaStore row" }
            .use(::sha256)
        val livePhotoId = requireNotNull(resolver.openInputStream(uri)) { "Cannot reopen MediaStore row" }
            .let(VivoMetadataScanner::findLivePhotoId)
        val marker = if (kind == MediaKind.VIDEO) {
            requireNotNull(resolver.openInputStream(uri)) { "Cannot reopen MediaStore row" }
                .let(VivoMetadataScanner::containsVivoMediaExtInfo)
        } else {
            false
        }
        return PostWriteMedia(digest, livePhotoId, marker, mediaIdentity.first, mediaIdentity.second)
    }

    override fun publish(ref: MediaRef) {
        val values = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
        check(resolver.update(Uri.parse(ref.uri), values, null, null) == 1) {
            "MediaStore publish did not update exactly one row"
        }
    }

    override fun delete(ref: MediaRef) {
        resolver.delete(Uri.parse(ref.uri), null, null)
    }

    private fun collection(kind: MediaKind): Uri = when (kind) {
        MediaKind.IMAGE -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        MediaKind.VIDEO -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI
    }

    private fun sha256(input: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count > 0) digest.update(buffer, 0, count)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
