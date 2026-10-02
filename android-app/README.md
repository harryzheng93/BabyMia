# BabyMia Android

这个目录构建统一的 BabyMia Android 应用。应用使用 WebView 显示 NAS 上的 BabyMia；只有 vivo Live Photo 选择、MediaStore 配对和原件上传由原生层完成。

## 使用

1. 在 NAS 上启动当前 BabyMia 服务，并确保手机可以访问其 HTTP/HTTPS 地址。
2. 安装 APK，首次启动填写 BabyMia 地址，例如 `http://192.168.1.100:8095`。
3. 在应用内完成 BabyMia 登录。
4. 进入“伴读”，点击“从 vivo 相册上传完整 Live Photo”。
5. 授予照片和视频完整访问权限，选择 vivo 动态照片。

客户端会读取 JPG 的 `com.android.camera.livephoto` ID，通过 MediaStore 查找同 ID 的 MP4，确认 `vivoMediaExtInfo` 后携带 WebView 登录 Cookie 上传。服务端再次校验后才保存。

## 构建

需要 JDK 17、Android SDK 35 和 Gradle 8.9。正式安装包必须使用项目的固定 Release 签名：

```powershell
cd android-app
gradle testDebugUnitTest assembleRelease
```

APK 输出：`android-app/app/build/outputs/apk/release/app-release.apk`。

如果本机没有打包工具，把整个项目推送到 GitHub，然后打开仓库的 **Actions → Build BabyMia Android APK → Run workflow**。构建通过后，在该次运行底部下载 `BabyMia-版本号-release-apk`。工作流还会创建对应的 GitHub Release，供 BabyMia 服务端自动同步。

发布签名由 GitHub Secrets 恢复，签名文件和密码不能提交到仓库。3.11 是自更新引导版，需要手动安装一次；以后 App 冷启动时会向自己的 BabyMia 服务端检查更新，发现新版先弹窗，确认后下载并交给 Android 系统安装。

当前允许局域网明文 HTTP，便于连接 NAS。对公网开放时应使用 HTTPS。
