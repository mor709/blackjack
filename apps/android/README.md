# 春山 21点 · Android 离线工程

这个目录里的 `www` 已包含完整离线游戏文件，不需要网络。

在安装 Android Studio、Java 和 Android SDK 的 Windows 或 macOS 电脑上，进入此目录后运行：

```text
npm install
npx cap add android
npm run sync:android
npm run open:android
```

随后在 Android Studio 中选择 Build APK，即可把它安装到手机。
