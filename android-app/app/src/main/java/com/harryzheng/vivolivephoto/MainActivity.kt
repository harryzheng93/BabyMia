package com.harryzheng.vivolivephoto

import android.Manifest
import android.app.Activity
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.URLUtil
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File
import java.util.UUID

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val preferences by lazy { getSharedPreferences("babymia", Context.MODE_PRIVATE) }
    private var baseUrl: String = ""
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingUploadSelection = false
    private var pendingRestoreItemId: String? = null

    private val imagePicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
        if (uri != null) showLivePhotoComposer(uri)
    }

    private val permissionRequest = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        val restoreItemId = pendingRestoreItemId
        val shouldSelect = pendingUploadSelection
        pendingRestoreItemId = null
        pendingUploadSelection = false
        if (!hasFullMediaAccess()) {
            val eventName = if (restoreItemId != null) "babymia:live-photo-restored" else "babymia:live-photo-uploaded"
            notifyWeb(false, "需要照片和视频完整访问权限，才能读取和保存 vivo Live Photo", eventName)
        } else if (restoreItemId != null) {
            restoreLivePhoto(restoreItemId)
        } else if (shouldSelect) {
            imagePicker.launch("image/jpeg")
        }
    }

    private val webFilePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uris = if (result.resultCode == Activity.RESULT_OK) {
            val data = result.data
            when {
                data?.clipData != null -> Array(data.clipData!!.itemCount) { index -> data.clipData!!.getItemAt(index).uri }
                data?.data != null -> arrayOf(data.data!!)
                else -> emptyArray()
            }
        } else emptyArray()
        fileChooserCallback?.onReceiveValue(uris)
        fileChooserCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.babyMiaWeb)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(0, bars.top, 0, bars.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.addJavascriptInterface(NativeBridge(), "BabyMiaNative")
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = callback
                return try {
                    val intent = params.createIntent().apply {
                        type = if (params.acceptTypes.any { it.startsWith("video/") }) "*/*" else "image/*"
                        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4"))
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                    }
                    webFilePicker.launch(intent)
                    true
                } catch (error: Exception) {
                    fileChooserCallback = null
                    callback.onReceiveValue(null)
                    Toast.makeText(this@MainActivity, "无法打开系统相册", Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val target = request.url
                val home = Uri.parse(baseUrl)
                if (target.scheme == home.scheme && target.encodedAuthority == home.encodedAuthority) return false
                startActivity(Intent(Intent.ACTION_VIEW, target))
                return true
            }
        }
        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val request = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mimeType)
                .setTitle(URLUtil.guessFileName(url, contentDisposition, mimeType))
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, contentDisposition, mimeType))
            CookieManager.getInstance().getCookie(baseUrl)?.let { request.addRequestHeader("Cookie", it) }
            request.addRequestHeader("User-Agent", userAgent)
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            Toast.makeText(this, "文件已加入系统下载", Toast.LENGTH_SHORT).show()
        }
        baseUrl = preferences.getString("base_url", "").orEmpty()
        if (baseUrl.isBlank()) showServerDialog(required = true) else loadHome()
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    inner class NativeBridge {
        @JavascriptInterface fun selectLivePhoto() = runOnUiThread {
            pendingRestoreItemId = null
            if (hasFullMediaAccess()) {
                imagePicker.launch("image/jpeg")
            } else {
                pendingUploadSelection = true
                permissionRequest.launch(requiredPermissions())
            }
        }

        @JavascriptInterface fun restoreLivePhoto(itemId: String) = runOnUiThread {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                notifyWeb(false, "保存 Live Photo 需要 Android 10 或更高版本", "babymia:live-photo-restored")
                return@runOnUiThread
            }
            if (!Regex("[0-9a-fA-F-]{36}").matches(itemId)) {
                notifyWeb(false, "Live Photo 编号无效", "babymia:live-photo-restored")
                return@runOnUiThread
            }
            pendingUploadSelection = false
            if (hasFullMediaAccess()) {
                this@MainActivity.restoreLivePhoto(itemId)
            } else {
                pendingRestoreItemId = itemId
                permissionRequest.launch(requiredPermissions())
            }
        }

        @JavascriptInterface fun configureServer() = runOnUiThread { showServerDialog(required = false) }
    }

    private fun showServerDialog(required: Boolean) {
        val input = EditText(this).apply {
            hint = "http://192.168.1.100:8095"
            setText(baseUrl)
            setSingleLine(true)
            setPadding(48, 20, 48, 20)
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("BabyMia 服务器地址")
            .setMessage("填写 NAS 上 BabyMia 的完整地址。手机和 NAS 需要能够互相访问。")
            .setView(input)
            .setPositiveButton("保存", null)
            .apply { if (!required) setNegativeButton("取消", null) }
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                try {
                    baseUrl = ServerEndpoint.fromUserInput(input.text.toString()).baseUrl
                    preferences.edit().putString("base_url", baseUrl).apply()
                    dialog.dismiss()
                    loadHome()
                } catch (error: IllegalArgumentException) {
                    input.error = error.message
                }
            }
        }
        dialog.setCanceledOnTouchOutside(!required)
        dialog.setCancelable(!required)
        dialog.show()
    }

    private fun loadHome() {
        webView.loadUrl(baseUrl)
    }

    private fun showLivePhotoComposer(uri: Uri) {
        val input = EditText(this).apply {
            hint = "记录这一刻…"
            minLines = 3
            maxLines = 6
            setPadding(48, 24, 48, 24)
        }
        AlertDialog.Builder(this)
            .setTitle("Live Photo 已选择")
            .setMessage("写下这张动态照片的描述，再保存到家庭时间线。")
            .setView(input)
            .setNegativeButton("取消", null)
            .setPositiveButton("保存") { _, _ -> pairAndUpload(uri, input.text.toString().trim().take(500)) }
            .show()
    }

    private fun pairAndUpload(uri: Uri, description: String) {
        Toast.makeText(this, "正在配对并上传 Live Photo…", Toast.LENGTH_LONG).show()
        Thread {
            try {
                val finder = MediaStorePairFinder(contentResolver)
                val image = finder.inspectSelectedImage(uri)
                val pair = finder.findCompanionVideo(image)
                val video = requireNotNull(pair.matched) { "没有找到 Live Photo 对应的 MP4；请授予完整照片和视频权限" }
                require(video.hasVivoMediaExtInfo) { "配对 MP4 缺少 vivoMediaExtInfo" }
                val plan = LivePhotoUploadPlan.create(baseUrl, image.displayName, video.displayName, image.livePhotoId, video.livePhotoId)
                val cookie = CookieManager.getInstance().getCookie(baseUrl)
                require(!cookie.isNullOrBlank()) { "请先在 BabyMia 中登录，再上传 Live Photo" }
                val originUri = Uri.parse(baseUrl)
                val origin = "${originUri.scheme}://${originUri.encodedAuthority}"
                val response = contentResolver.openInputStream(image.uri).use { imageInput ->
                    requireNotNull(imageInput) { "无法读取 JPG 原件" }
                    contentResolver.openInputStream(video.uri).use { videoInput ->
                        requireNotNull(videoInput) { "无法读取 MP4 原件" }
                        LivePhotoUploader().upload(
                            plan, imageInput, videoInput,
                            contentResolver.getType(image.uri) ?: "image/jpeg",
                            contentResolver.getType(video.uri) ?: "video/mp4",
                            cookie, origin,
                            UUID.randomUUID().toString(), description
                        )
                    }
                }
                if (response.statusCode !in 200..299) throw IllegalStateException("服务器返回 HTTP ${response.statusCode}：${response.body.take(180)}")
                notifyWeb(true, "Live Photo 已上传")
            } catch (error: Exception) {
                notifyWeb(false, error.message ?: "Live Photo 上传失败")
            }
        }.start()
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    private fun restoreLivePhoto(itemId: String) {
        Toast.makeText(this, "正在保存完整 Live Photo…", Toast.LENGTH_LONG).show()
        Thread {
            try {
                val cookie = CookieManager.getInstance().getCookie(baseUrl)
                require(!cookie.isNullOrBlank()) { "请先在 BabyMia 中登录，再下载 Live Photo" }
                val originUri = Uri.parse(baseUrl)
                val origin = "${originUri.scheme}://${originUri.encodedAuthority}"
                val result = RestoreTempFiles.withFiles(File(cacheDir, "livephoto-restore")) { imageFile, videoFile ->
                    val client = LivePhotoServerClient(
                        ServerEndpoint.fromUserInput(baseUrl),
                        cookie = cookie,
                        origin = origin,
                    )
                    val manifest = client.manifest(itemId)
                    client.download(manifest.imageUrl, imageFile)
                    client.download(manifest.videoUrl, videoFile)
                    val verified = DownloadedLivePhotoVerifier.verify(manifest, imageFile, videoFile)
                    LivePhotoRestoreCoordinator(AndroidMediaStoreGateway(contentResolver)).restore(verified)
                }
                notifyWeb(
                    true,
                    "Live Photo 已保存到系统相册 DCIM/Camera（${result.names.imageName}）",
                    "babymia:live-photo-restored",
                )
            } catch (error: Exception) {
                notifyWeb(false, error.message ?: "Live Photo 保存失败", "babymia:live-photo-restored")
            }
        }.start()
    }

    private fun notifyWeb(
        success: Boolean,
        message: String,
        eventName: String = "babymia:live-photo-uploaded",
    ) = runOnUiThread {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        val detail = JSONObject().put("success", success).put("message", message).toString()
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('$eventName',{detail:$detail}))", null)
    }

    private fun hasFullMediaAccess(): Boolean = if (Build.VERSION.SDK_INT >= 33) {
        granted(Manifest.permission.READ_MEDIA_IMAGES) && granted(Manifest.permission.READ_MEDIA_VIDEO)
    } else granted(Manifest.permission.READ_EXTERNAL_STORAGE)

    private fun granted(permission: String) = ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun requiredPermissions(): Array<String> = when {
        Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
        else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
}
