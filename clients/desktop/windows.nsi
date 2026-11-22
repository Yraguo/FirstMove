Unicode true
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

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yraguo.FirstMove"
!define DEFAULT_DIR "$LOCALAPPDATA\Programs\Yraguo\FirstMove"
!define MUI_FINISHPAGE_RUN "$INSTDIR\app\先行.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即打开先行"
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择安装位置。可以换到其他盘，例如 D:\Apps\FirstMove。"
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE directoryLeave

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

Function directoryLeave
  ; 先把目录建出来，再试写一个文件。写不进去就当场拦住，
  ; 而不是解压到一半才失败，最后只剩一个装了一半的目录。
  CreateDirectory "$INSTDIR"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "无法创建目录：$\r$\n$INSTDIR$\r$\n$\r$\n换一个位置试试，不要选只读盘或没有权限的文件夹。"
    Abort
  ${EndIf}

  ClearErrors
  FileOpen $0 "$INSTDIR\.firstmove-write-test" w
  ${If} ${Errors}
    MessageBox MB_ICONSTOP "这个目录写不进去：$\r$\n$INSTDIR$\r$\n$\r$\n可能位于受保护的位置，或者磁盘已满、被安全软件拦截。请换一个目录。"
    Abort
  ${EndIf}
  FileClose $0
  Delete "$INSTDIR\.firstmove-write-test"
FunctionEnd

Section "先行运行文件（必需）" SecMain
  SectionIn RO
  SetShellVarContext current

  ; 程序在运行时文件被占用，先请它退出；失败也无所谓，后面写入自然会报错
  nsExec::ExecToLog 'taskkill /IM "先行.exe"'
  Pop $0
  Sleep 600

  ; 换了安装位置的话，默认位置那份旧副本会留下来，装完就有两个先行
  StrCmp $INSTDIR "${DEFAULT_DIR}" noOldCopy 0
  IfFileExists "${DEFAULT_DIR}\app\先行.exe" 0 noOldCopy
    MessageBox MB_YESNO|MB_ICONQUESTION "默认位置还有一份旧的安装：$\r$\n${DEFAULT_DIR}$\r$\n$\r$\n要顺手删掉吗？不删也不影响这次安装。" IDNO noOldCopy
    RMDir /r "${DEFAULT_DIR}"
  noOldCopy:

  SetOutPath "$INSTDIR\app"
  SetOverwrite on
  File /r "${APPDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\先行.lnk" "$INSTDIR\app\先行.exe"
  CreateShortcut "$SMPROGRAMS\卸载 先行.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Yraguo\FirstMove" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "先行 · FirstMove"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "0.3.2"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\app\先行.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Yraguo"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
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
  nsExec::ExecToLog 'taskkill /IM "先行.exe"'
  Pop $0
  Sleep 400
  ; 目录可能被改到别的盘，先确认里面确实是先行，再动手删除
  ${IfNot} ${FileExists} "$INSTDIR\app\先行.exe"
    MessageBox MB_ICONSTOP "这个目录里没有先行程序文件，已停止卸载：$\r$\n$INSTDIR"
    Abort
  ${EndIf}
  Delete "$SMPROGRAMS\先行.lnk"
  Delete "$SMPROGRAMS\卸载 先行.lnk"
  Delete "$DESKTOP\先行.lnk"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\Yraguo\FirstMove"
SectionEnd
