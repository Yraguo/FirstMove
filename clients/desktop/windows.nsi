Unicode true
Name "先行 · FirstMove"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Yraguo\FirstMove"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "${ICON}"
UninstallIcon "${ICON}"

!include "MUI2.nsh"
!include "x64.nsh"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Yraguo.FirstMove"
!define MUI_FINISHPAGE_RUN "$INSTDIR\app\先行.exe"
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

Section
  SetShellVarContext current
  SetOutPath "$INSTDIR\app"
  SetOverwrite on
  File /r "${APPDIR}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\先行.lnk" "$INSTDIR\app\先行.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "先行 · FirstMove"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "0.2.1"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\app\先行.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Yraguo"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\Yraguo\FirstMove" +2
  Abort
  Delete "$SMPROGRAMS\先行.lnk"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
