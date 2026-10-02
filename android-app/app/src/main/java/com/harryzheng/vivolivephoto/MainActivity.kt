package com.harryzheng.vivolivephoto

import android.Manifest
import android.app.Activity
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.URLUtil
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.RequiresApi
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.view.View
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class MainActivity : AppCompatActivity() {
    private lateinit var rootView: FrameLayout
    private lateinit var webView: WebView
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private val preferences by lazy { getSharedPreferences("babymia", Context.MODE_PRIVATE) }
    private var baseUrl: String = ""
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingUploadSelection = false
    private var pendingRestoreItemId: String? = null
    private var updateDownloadReceiver: BroadcastReceiver? = null
    private var pendingInstallApk: File? = null
    private var waitingForInstallPermission = false
    private var updateCheckStarted = false

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
        rootView = findViewById(R.id.babyMiaRoot)
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
            override fun onShowCustomView(view: View, callback: WebChromeClient.CustomViewCallback) {
                showFullscreenVideo(view, callback)
            }

            override fun onHideCustomView() {
                hideFullscreenVideo()
            }

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
        registerUpdateDownloadReceiver()
        baseUrl = preferences.getString("base_url", "").orEmpty()
        if (baseUrl.isBlank()) {
            showServerDialog(required = true)
        } else {
            loadHome()
            if (!resumePendingAppUpdate()) checkForAppUpdate()
        }
    }

    override fun onResume() {
        super.onResume()
        if (waitingForInstallPermission) {
            waitingForInstallPermission = false
            val apk = pendingInstallApk
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()) {
                if (apk != null) installDownloadedUpdate(apk)
            } else {
                Toast.makeText(this, "需要允许 BabyMia 安装更新", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onDestroy() {
        updateDownloadReceiver?.let { unregisterReceiver(it) }
        updateDownloadReceiver = null
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (fullscreenView != null) hideFullscreenVideo()
        else if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    private fun showFullscreenVideo(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (fullscreenView != null) {
            callback.onCustomViewHidden()
            return
        }
        fullscreenView = view
        fullscreenCallback = callback
        webView.visibility = View.GONE
        rootView.addView(
            view,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT,
            ),
        )
        WindowInsetsControllerCompat(window, rootView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun hideFullscreenVideo() {
        val view = fullscreenView ?: return
        rootView.removeView(view)
        fullscreenView = null
        fullscreenCallback?.onCustomViewHidden()
        fullscreenCallback = null
        webView.visibility = View.VISIBLE
        WindowInsetsControllerCompat(window, rootView).show(WindowInsetsCompat.Type.systemBars())
        ViewCompat.requestApplyInsets(webView)
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
                    checkForAppUpdate()
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

    private fun checkForAppUpdate() {
        if (updateCheckStarted || baseUrl.isBlank()) return
        updateCheckStarted = true
        Thread {
            try {
                val endpoint = URL("${baseUrl.trimEnd('/')}/api/app-update/latest?versionCode=${BuildConfig.VERSION_CODE}")
                val connection = (endpoint.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 6000
                    readTimeout = 10000
                    requestMethod = "GET"
                    setRequestProperty("Accept", "application/json")
                }
                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val update = if (connection.responseCode == 200) {
                    AppUpdateInfo.availableFrom(body, BuildConfig.VERSION_CODE)
                } else null
                connection.disconnect()
                if (update != null) runOnUiThread { showUpdateAvailableDialog(update) }
            } catch (_: Exception) {
                // Update checks stay silent when the NAS or network is temporarily unavailable.
            }
        }.start()
    }

    private fun showUpdateAvailableDialog(update: AppUpdateInfo) {
        if (isFinishing || isDestroyed) return
        val sizeText = if (update.size > 0) "\n安装包：${"%.1f".format(update.size / 1024.0 / 1024.0)} MB" else ""
        val notes = update.releaseNotes.ifBlank { "包含最新功能和问题修复。" }
        AlertDialog.Builder(this)
            .setTitle("发现新版本 ${update.versionName}")
            .setMessage("$notes$sizeText\n\n是否现在下载更新？")
            .setNegativeButton("稍后", null)
            .setPositiveButton("立即更新") { _, _ -> downloadAppUpdate(update) }
            .show()
    }

    private fun downloadAppUpdate(update: AppUpdateInfo) {
        try {
            val downloadUrl = URL(URL("${baseUrl.trimEnd('/')}/"), update.downloadUrl).toString()
            val fileName = "BabyMia-${update.versionName}-release.apk"
            val target = File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName)
            if (target.exists()) target.delete()
            val request = DownloadManager.Request(Uri.parse(downloadUrl))
                .setMimeType("application/vnd.android.package-archive")
                .setTitle("BabyMia ${update.versionName}")
                .setDescription("正在下载应用更新")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName)
            val id = (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            preferences.edit()
                .putLong("update_download_id", id)
                .putInt("update_version_code", update.versionCode)
                .putString("update_apk_path", target.absolutePath)
                .apply()
            Toast.makeText(this, "开始下载 BabyMia ${update.versionName}", Toast.LENGTH_LONG).show()
        } catch (error: Exception) {
            Toast.makeText(this, error.message ?: "无法下载应用更新", Toast.LENGTH_LONG).show()
        }
    }

    private fun registerUpdateDownloadReceiver() {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
                val expected = preferences.getLong("update_download_id", -1L)
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -2L) == expected) resumePendingAppUpdate()
            }
        }
        updateDownloadReceiver = receiver
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("DEPRECATION")
            registerReceiver(receiver, filter)
        }
    }

    private fun resumePendingAppUpdate(): Boolean {
        val versionCode = preferences.getInt("update_version_code", 0)
        val downloadId = preferences.getLong("update_download_id", -1L)
        val path = preferences.getString("update_apk_path", null)
        if (versionCode <= BuildConfig.VERSION_CODE || downloadId < 0 || path.isNullOrBlank()) {
            clearPendingAppUpdate()
            return false
        }
        val cursor = (getSystemService(DOWNLOAD_SERVICE) as DownloadManager)
            .query(DownloadManager.Query().setFilterById(downloadId))
        cursor.use {
            if (!it.moveToFirst()) {
                clearPendingAppUpdate()
                return false
            }
            val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            return when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> {
                    val apk = File(path)
                    if (apk.isFile) installDownloadedUpdate(apk) else clearPendingAppUpdate()
                    true
                }
                DownloadManager.STATUS_PENDING,
                DownloadManager.STATUS_PAUSED,
                DownloadManager.STATUS_RUNNING -> true
                else -> {
                    clearPendingAppUpdate()
                    false
                }
            }
        }
    }

    private fun installDownloadedUpdate(apk: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
            pendingInstallApk = apk
            waitingForInstallPermission = true
            Toast.makeText(this, "请允许 BabyMia 安装更新", Toast.LENGTH_LONG).show()
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            return
        }
        pendingInstallApk = null
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apk)
        startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            },
        )
    }

    private fun clearPendingAppUpdate() {
        preferences.edit()
            .remove("update_download_id")
            .remove("update_version_code")
            .remove("update_apk_path")
            .apply()
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
