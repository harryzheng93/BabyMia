package com.harryzheng.vivolivephoto

import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.nio.charset.StandardCharsets

class MultipartBodyWriter(
    private val boundary: String,
    private val output: OutputStream
) : Closeable {
    private var closed = false

    fun writeText(name: String, value: String) {
        check(!closed) { "multipart writer already closed" }
        writeAscii("--$boundary\r\n")
        writeAscii("Content-Disposition: form-data; name=\"${escape(name)}\"\r\n")
        writeAscii("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
        output.write(value.toByteArray(StandardCharsets.UTF_8))
        writeAscii("\r\n")
    }

    fun writeFile(
        name: String,
        fileName: String,
        contentType: String,
        input: InputStream
    ) {
        check(!closed) { "multipart writer already closed" }
        writeAscii("--$boundary\r\n")
        writeAscii(
            "Content-Disposition: form-data; name=\"${escape(name)}\"; " +
                "filename=\"${escape(fileName)}\"\r\n"
        )
        writeAscii("Content-Type: $contentType\r\n\r\n")
        input.use { it.copyTo(output, DEFAULT_BUFFER_SIZE) }
        writeAscii("\r\n")
    }

    override fun close() {
        if (closed) return
        writeAscii("--$boundary--\r\n")
        output.flush()
        closed = true
    }

    private fun writeAscii(value: String) {
        output.write(value.toByteArray(StandardCharsets.ISO_8859_1))
    }

    private fun escape(value: String): String =
        value.replace("\\", "\\\\").replace("\"", "\\\"")
}
