# FirstMove 客户端构建

安装包连接使用者自己填写的 HTTPS 地址，网页、API 和用户资料都来自这个地址。Android 是内嵌 WebView 的应用外壳，打开应用后不再跳出系统浏览器；桌面端是 Electron 独立窗口。地址配置界面与图标随客户端安装。

## Android

需要 JDK 17、Android SDK Platform 35、Build Tools 35.0.0，以及 Bash 和 zip。在仓库根目录运行。首次发布时创建专用密钥，以后更新版本必须沿用同一密钥并递增 manifest 中的 versionCode。密钥库和口令应私下备份。

```sh
export JAVA_HOME=/path/to/jdk-17
export ANDROID_PLATFORM="$ANDROID_HOME/platforms/android-35"
export ANDROID_TOOLS="$ANDROID_HOME/build-tools/35.0.0"
export FIRSTMOVE_KEYSTORE=/private/path/firstmove.p12
"$JAVA_HOME/bin/keytool" -genkeypair -storetype PKCS12 -keystore "$FIRSTMOVE_KEYSTORE" -alias firstmove -keyalg RSA -keysize 3072 -validity 10000
# Bash: enter the existing keystore password without displaying it.
read -rsp 'Keystore password: ' FIRSTMOVE_STORE_PASS
export FIRSTMOVE_STORE_PASS
bash clients/android/build.sh
unset FIRSTMOVE_STORE_PASS
```

输出为 `dist/FirstMove-0.3.2-android.apk`。构建会执行 APK 签名验证。应用 ID 为 `io.github.yraguo.firstmove`，最低 Android 7.0，当前 versionCode 为 6。首版发布证书的 SHA-256 指纹为 `ae1b2eef27625cdb4020e61af962b704429719bc1dd2a9a3bd1a1fb98c795206`。

应用内是 WebView 外壳，不调用系统浏览器：同源页面在应用内打开，外站链接交给系统浏览器；返回键先回退页面，到底后退到后台；地址只保存一次。外壳通过 `window.FirstMove` 向页面提供三个能力，网页版与桌面端没有这个对象，相关分支会自动跳过：

| 能力 | 页面调用处 | 说明 |
| --- | --- | --- |
| 保存附件到系统「下载」 | `frontend/src/native.js` 的 `saveBlobToDevice` | 分块 Base64 传字节，Android 10 及以上走 MediaStore，9 及以下需存储权限 |
| 系统通知 | `native.js` 的 `nativeNotify` | 提醒只在应用运行时送达；锁屏与后台推送仍未实现 |
| 复制链接 | `native.js` 的 `copyText` | 走系统剪贴板；其余环境退回 `execCommand` |
| 文件选择 | 标准 `<input type="file">` | 由 `onShowFileChooser` 承接，附件上传可用 |

应用内地址只保存一次，连不上时出现「重试」和「更换服务器地址」两个按钮，是换服务器的唯一入口。首次进入页面会申请通知权限。

## 安装包图标

图标源文件是 `clients/icons/source.png`（整张铺满酒红，没有白底）。运行

```sh
python3 clients/icons/build_icons.py
```

会按平台规范重新生成三个文件，圆角外面是透明而不是白色，所以在深色桌面、
安装界面和任务栏上都不会露出白边：

| 产物 | 用途 |
| --- | --- |
| `clients/desktop/icon.png` | macOS，1024 画布、内容 824、圆角 185（Apple 网格） |
| `clients/desktop/icon-win.png` | Windows，1024 画布、内容 944、圆角 177 |
| `clients/icons/app-512.png` | Android 启动图标，512、圆角 113 |

换图标时只替换 `source.png` 再跑一次脚本，不要直接改生成的 PNG。

## Windows 安装程序

`clients/desktop/windows.nsi` 提供四个页面：欢迎、**选择安装位置**、**选择组件**
（可勾选是否创建桌面快捷方式）、安装。默认目录是
`%LOCALAPPDATA%\Programs\Yraguo\FirstMove`，可以改到其他盘，例如
`D:\Apps\FirstMove`，目标目录需要当前用户有写入权限。

安装程序以当前用户身份运行（不弹 UAC），卸载信息同样记在当前用户下。装过一次后
再次运行会沿用上次选择的目录。卸载前会检查目标目录里确实有 `app\先行.exe`，
避免目录被改到别处后误删。

## 卸载

**Windows**：安装时已写入卸载信息，在「设置 → 应用」里搜「先行」即可卸载；开始菜单里也放了
「卸载 先行」快捷方式，指向安装目录下的 `Uninstall.exe`。卸载会删掉程序文件、开始菜单与桌面
快捷方式，`%APPDATA%` 下的登录状态会保留，重新安装后按需登录。

**macOS**：DMG 里除了「先行」还有一个「卸载 先行.command」。双击后它会先列出将要删除的内容
并要求确认，再退出应用、删除 `/Applications/先行.app` 与
`~/Library/Application Support/先行` 等本机数据。从网上下载的文件带隔离标记，首次双击可能
提示「无法验证开发者」，右键 →「打开」即可；也可以在终端里执行
`bash "/Volumes/先行 0.3.1-arm64/卸载 先行.command"`。

**Android**：按系统常规方式卸载。应用数据随应用一起删除。

三端卸载都不会影响服务器上的账号、待办、记录和附件，重新安装并登录后仍在。

## 桌面端

需要 Node.js 22 或更新版本和 npm。在 `clients/desktop` 执行 `npm ci`。工作台页面运行在隔离的沙盒中，用户账号沿用服务器的同源会话。要连接本地测试服务可填写 `http://127.0.0.1:8000`。

- **Apple 芯片 Mac**：在 macOS 执行 `npx electron-builder --mac dmg --arm64 --publish never`。输出在仓库根目录的 `dist/desktop/`。首版使用本机 ad-hoc 签名。
- **Windows x64**：在 Windows 执行 `npx electron-builder --win nsis --x64 --publish never`。在 Apple 芯片 Mac 交叉构建本次发布的安装程序时，先用 electron-builder 打包应用目录，再用本机架构的 NSIS 3 编译。以下命令从 `clients/desktop` 运行：

```sh
npx electron-builder --win --dir --x64 --publish never -c.directories.output=../../dist/win-release
out="$(cd ../../dist && pwd)"
makensis "-DAPPDIR=$out/win-release/win-unpacked" \
  "-DICON=$out/win-release/.icon-ico/icon.ico" \
  "-DOUTPUT=$out/FirstMove-0.1.0-windows-x64-Setup.exe" windows.nsi
```

发布时仅上传已经验证的 DMG、EXE、APK 和 SHA256SUMS.txt。签名私钥、本地数据库、账号及开发环境不在发布内容中。
