# 春山 21点

独立的离线 21 点游戏，包含可维护的网页源代码、Windows EXE 和 Android APK。

## 运行源代码

```text
npm install
npm run dev
```

执行 `npm run build` 可生成静态网页到 `dist/`。

## 发布文件

- `releases/春山21点.exe`：Windows 离线应用。
- `releases/春山21点.apk`：Android 离线应用。

## 应用工程

- `apps/windows/`：Windows 启动器源代码与内置网页资源。
- `apps/android/`：Capacitor Android 工程与内置网页资源。
