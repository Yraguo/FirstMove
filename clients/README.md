# FirstMove 客户端构建

安装包连接使用者自己填写的 HTTPS 域名。网页、API 和用户资料都来自该域名。Android 使用浏览器 Custom Tabs，桌面端使用 Electron 独立窗口。地址配置界面与图标随客户端安装。

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

输出为 `dist/FirstMove-0.1.0-android.apk`。构建会执行 APK 签名验证。应用 ID 为 `io.github.yraguo.firstmove`，最低 Android 7.0。首版发布证书的 SHA-256 指纹为 `ae1b2eef27625cdb4020e61af962b704429719bc1dd2a9a3bd1a1fb98c795206`。

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
