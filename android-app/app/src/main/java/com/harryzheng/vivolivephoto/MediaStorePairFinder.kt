package com.harryzheng.vivolivephoto

import android.content.ContentUris
import android.content.ContentResolver
import android.database.Cursor
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns

private const val NEARBY_WINDOW_MS = 10_000L

data class SelectedImageInfo(
    val uri: Uri,
    val displayName: String,
    val relativePath: String?,
    val dateTaken: Long?,
    val size: Long?,
    val livePhotoId: String?
)

data class VideoCandidate(
    val uri: Uri,
    val displayName: String,
    val relativePath: String?,
    val dateTaken: Long?,
    val size: Long?,
    val livePhotoId: String?,
    val hasVivoMediaExtInfo: Boolean
)

data class PairSearchResult(
    val image: SelectedImageInfo,
    val exactCandidates: List<VideoCandidate>,
    val nearbyCandidates: List<VideoCandidate>,
    val matched: VideoCandidate?
)

class MediaStorePairFinder(private val resolver: ContentResolver) {

    fun inspectSelectedImage(uri: Uri): SelectedImageInfo {
        val displayName = queryString(uri, OpenableColumns.DISPLAY_NAME) ?: "(unknown)"
        val size = queryLong(uri, OpenableColumns.SIZE)
        val relativePath = queryString(uri, MediaStore.MediaColumns.RELATIVE_PATH)
        val dateTaken = queryLong(uri, MediaStore.Images.Media.DATE_TAKEN)
        val livePhotoId = resolver.openInputStream(uri)?.let(VivoMetadataScanner::findLivePhotoId)

        return SelectedImageInfo(
            uri = uri,
            displayName = displayName,
            relativePath = relativePath,
            dateTaken = dateTaken,
            size = size,
            livePhotoId = livePhotoId
        )
    }

    fun findCompanionVideo(image: SelectedImageInfo): PairSearchResult {
        val baseName = image.displayName.substringBeforeLast('.', image.displayName)
        val exactRows = queryVideos(
            selection = buildString {
                append("${MediaStore.Video.Media.DISPLAY_NAME} LIKE ?")
                if (image.relativePath != null) {
                    append(" AND ${MediaStore.Video.Media.RELATIVE_PATH} = ?")
                }
            },
            args = buildList {
                add("$baseName.%")
                image.relativePath?.let(::add)
            }.toTypedArray()
        ).filter {
            it.displayName.substringBeforeLast('.', it.displayName).equals(baseName, ignoreCase = true)
        }

        val exactCandidates = exactRows.map(::inspectVideo)
        val exactMatch = exactCandidates.firstOrNull {
            image.livePhotoId != null && image.livePhotoId == it.livePhotoId
        }

        if (exactMatch != null) {
            return PairSearchResult(image, exactCandidates, emptyList(), exactMatch)
        }

        val nearbyCandidates = if (image.dateTaken != null) {
            val start = image.dateTaken - NEARBY_WINDOW_MS
            val end = image.dateTaken + NEARBY_WINDOW_MS
            queryVideos(
                selection = buildString {
                    append("${MediaStore.Video.Media.DATE_TAKEN} BETWEEN ? AND ?")
                    if (image.relativePath != null) {
                        append(" AND ${MediaStore.Video.Media.RELATIVE_PATH} = ?")
                    }
                },
                args = buildList {
                    add(start.toString())
                    add(end.toString())
                    image.relativePath?.let(::add)
                }.toTypedArray()
            ).map(::inspectVideo)
        } else {
            emptyList()
        }

        val nearbyMatch = nearbyCandidates.firstOrNull {
            image.livePhotoId != null && image.livePhotoId == it.livePhotoId
        }

        return PairSearchResult(image, exactCandidates, nearbyCandidates, nearbyMatch)
    }

    private data class VideoRow(
        val uri: Uri,
        val displayName: String,
        val relativePath: String?,
        val dateTaken: Long?,
        val size: Long?
    )

    private fun queryVideos(selection: String, args: Array<String>): List<VideoRow> {
        val result = mutableListOf<VideoRow>()
        val projection = arrayOf(
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.DISPLAY_NAME,
            MediaStore.Video.Media.RELATIVE_PATH,
            MediaStore.Video.Media.DATE_TAKEN,
            MediaStore.Video.Media.SIZE
        )

        resolver.query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            projection,
            selection,
            args,
            "${MediaStore.Video.Media.DATE_TAKEN} DESC"
        )?.use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
            val nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
            val pathIndex = cursor.getColumnIndex(MediaStore.Video.Media.RELATIVE_PATH)
            val dateIndex = cursor.getColumnIndex(MediaStore.Video.Media.DATE_TAKEN)
            val sizeIndex = cursor.getColumnIndex(MediaStore.Video.Media.SIZE)

            while (cursor.moveToNext()) {
                val id = cursor.getLong(idIndex)
                result += VideoRow(
                    uri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id),
                    displayName = cursor.getString(nameIndex),
                    relativePath = cursor.nullableString(pathIndex),
                    dateTaken = cursor.nullableLong(dateIndex),
                    size = cursor.nullableLong(sizeIndex)
                )
            }
        }
        return result
    }

    private fun inspectVideo(row: VideoRow): VideoCandidate {
        val id = resolver.openInputStream(row.uri)?.let(VivoMetadataScanner::findLivePhotoId)
        val hasMarker = resolver.openInputStream(row.uri)?.let(VivoMetadataScanner::containsVivoMediaExtInfo) ?: false

        return VideoCandidate(
            uri = row.uri,
            displayName = row.displayName,
            relativePath = row.relativePath,
            dateTaken = row.dateTaken,
            size = row.size,
            livePhotoId = id,
            hasVivoMediaExtInfo = hasMarker
        )
    }

    private fun queryString(uri: Uri, column: String): String? = try {
        resolver.query(uri, arrayOf(column), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.nullableString(0) else null
        }
    } catch (_: Exception) {
        null
    }

    private fun queryLong(uri: Uri, column: String): Long? = try {
        resolver.query(uri, arrayOf(column), null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) cursor.nullableLong(0) else null
        }
    } catch (_: Exception) {
        null
    }

    private fun Cursor.nullableString(index: Int): String? =
        if (index < 0 || isNull(index)) null else getString(index)

    private fun Cursor.nullableLong(index: Int): Long? =
        if (index < 0 || isNull(index)) null else getLong(index)
}
