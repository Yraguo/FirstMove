Unicode true
Name "先行 · FirstMove"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Yraguo\FirstMove"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "${ICON}"
UninstallIcon "${ICON}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yraguo.FirstMove"
!define MUI_FINISHPAGE_RUN "$INSTDIR\app\先行.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即打开先行"
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择安装位置。可以换到其他盘，例如 D:\Apps\FirstMove。目标文件夹需要当前用户有写入权限。"
!define MUI_PAGE_CUSTOMFUNCTION_PRE directoryPage

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "FirstMove requires 64-bit Windows."
    Abort
  ${EndIf}
FunctionEnd

Function directoryPage
  ; 装过一次之后再次运行时，沿用上次选择的目录
  ReadRegStr $0 HKCU "Software\Yraguo\FirstMove" "InstallDir"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
FunctionEnd

Section "先行运行文件（必需）" SecMain
  SectionIn RO
  SetShellVarContext current
  SetOutPath "$INSTDIR\app"
  SetOverwrite on
  File /r "${APPDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\先行.lnk" "$INSTDIR\app\先行.exe"
  WriteRegStr HKCU "Software\Yraguo\FirstMove" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "先行 · FirstMove"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "0.3.0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\app\先行.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Yraguo"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "创建桌面快捷方式" SecDesktop
  SetShellVarContext current
  CreateShortcut "$DESKTOP\先行.lnk" "$INSTDIR\app\先行.exe"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "程序文件与开始菜单入口，卸载信息登记在这里。"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "在桌面放一个「先行」图标。不勾选也可以之后手动创建。"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  SetShellVarContext current
  ; 目录可能被改到别的盘，先确认里面确实是先行，再动手删除
  ${IfNot} ${FileExists} "$INSTDIR\app\先行.exe"
    MessageBox MB_ICONSTOP "这个目录里没有先行程序文件，已停止卸载：$INSTDIR"
    Abort
  ${EndIf}
  Delete "$SMPROGRAMS\先行.lnk"
  Delete "$DESKTOP\先行.lnk"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\Yraguo\FirstMove"
SectionEnd
