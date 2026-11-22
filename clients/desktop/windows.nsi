Unicode true
!addplugindir /x86-unicode "${NSIS_PLUGINS}"
Name "先行 · FirstMove"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Yraguo\FirstMove"
InstallDirRegKey HKCU "Software\Yraguo\FirstMove" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "${ICON}"
UninstallIcon "${ICON}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yraguo.FirstMove"
!define APP_KEY "Software\Yraguo\FirstMove"
!define APP_EXE "$INSTDIR\app\先行.exe"
!define APP_ICON "$INSTDIR\app\FirstMove.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\app\先行.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即打开先行"
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择安装位置。可以换到其他盘，例如 D:\Apps\FirstMove。"

!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE directoryLeave
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

Function checkInstallDirectory
  ClearErrors
  GetFullPathName $INSTDIR "$INSTDIR"
  ${If} ${Errors}
    Return
  ${EndIf}
  ${GetRoot} "$INSTDIR" $0
  ${If} $0 == ""
  ${OrIf} $INSTDIR == "$0"
  ${OrIf} $INSTDIR == "$0\"
    SetErrors
    Return
  ${EndIf}

  CreateDirectory "$INSTDIR"
  ${If} ${Errors}
    Return
  ${EndIf}
  GetTempFileName $0 "$INSTDIR"
  ${If} ${Errors}
    Return
  ${EndIf}
  Delete "$0"

  CreateDirectory "$INSTDIR\app"
  ${If} ${Errors}
    Return
  ${EndIf}
  GetTempFileName $0 "$INSTDIR\app"
  ${IfNot} ${Errors}
    Delete "$0"
  ${EndIf}
FunctionEnd

Function directoryLeave
  Call checkInstallDirectory
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "无法写入安装目录：$\r$\n$INSTDIR$\r$\n请选择有写入权限的子文件夹，例如 D:\Apps\FirstMove。"
    Abort
  ${EndIf}
FunctionEnd

Section "先行运行文件（必需）" SecMain
  SectionIn RO
  SetShellVarContext current

  ; 静默安装跳过目录页，也需要校验 /D 指定的目标。
  Call checkInstallDirectory
  ${If} ${Errors}
    SetErrorLevel 1
    MessageBox MB_ICONSTOP "无法写入安装目录：$\r$\n$INSTDIR" /SD IDOK
    Abort
  ${EndIf}

  ; 程序在运行时文件被占用，先请它退出；失败也无所谓，后面写入自然会报错
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "先行.exe"'
  Pop $0
  Sleep 600

  ClearErrors
  SetOutPath "$INSTDIR\app"
  SetOverwrite on
  File /r "${APPDIR}\*.*"
  File /oname=FirstMove.ico "${ICON}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  ${If} ${Errors}
    SetErrorLevel 1
    MessageBox MB_ICONSTOP "无法写入程序文件：$\r$\n$INSTDIR" /SD IDOK
    Abort
  ${EndIf}
  CreateShortcut "$SMPROGRAMS\先行.lnk" "${APP_EXE}" "" "${APP_ICON}" 0
  WinShell::SetLnkAUMI "$SMPROGRAMS\先行.lnk" "${APP_ID}"
  CreateShortcut "$SMPROGRAMS\卸载 先行.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0
  WriteRegStr HKCU "${APP_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "先行 · FirstMove"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "${APP_ICON},0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Yraguo"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "创建桌面快捷方式" SecDesktop
  SetShellVarContext current
  CreateShortcut "$DESKTOP\先行.lnk" "${APP_EXE}" "" "${APP_ICON}" 0
  WinShell::SetLnkAUMI "$DESKTOP\先行.lnk" "${APP_ID}"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "程序文件与开始菜单入口，卸载信息登记在这里。"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "在桌面放一个「先行」图标。不勾选也可以之后手动创建。"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  SetShellVarContext current
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "先行.exe"'
  Pop $0
  Sleep 400
  ; 目录可能被改到别的盘，先确认里面确实是先行，再动手删除
  ${IfNot} ${FileExists} "$INSTDIR\app\先行.exe"
    MessageBox MB_ICONSTOP "这个目录里没有先行程序文件，已停止卸载：$\r$\n$INSTDIR"
    Abort
  ${EndIf}
  ReadRegStr $0 HKCU "${APP_KEY}" "InstallDir"
  ${If} $0 == $INSTDIR
    Delete "$SMPROGRAMS\先行.lnk"
    Delete "$SMPROGRAMS\卸载 先行.lnk"
    Delete "$DESKTOP\先行.lnk"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    DeleteRegKey HKCU "${APP_KEY}"
  ${EndIf}
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
