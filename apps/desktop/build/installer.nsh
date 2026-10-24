; TDS Companion installer skin.
;
; The wizard stays electron-builder's assisted installer (directory choice, per-user mode, silent
; upgrades), but the first and last pages are a branded full-page surface with a six-frame animated
; sidebar. Keeping the stock install section is deliberate: electron-updater runs the same binary
; with /S and needs the normal extraction/registry path.

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

!ifndef BUILD_UNINSTALLER

Var TdsWelcomeDialog
Var TdsWelcomeImage
Var TdsWelcomeHandle
Var TdsWelcomeFrame
Var TdsFinishDialog
Var TdsFinishImage
Var TdsFinishHandle
Var TdsFinishFrame
Var TdsFinishRun

!define TDS_DARK "0B0E14"
!define TDS_PANEL "111827"
!define TDS_INK "E6EDF6"
!define TDS_MUTE "9AA7B8"
!define TDS_BRAND "4C8DFF"

!macro customInit
  InitPluginsDir
  ${IfNot} ${Silent}
    File /oname=$PLUGINSDIR\tds-welcome-0.bmp "${BUILD_RESOURCES_DIR}\installer\welcome-0.bmp"
    File /oname=$PLUGINSDIR\tds-welcome-1.bmp "${BUILD_RESOURCES_DIR}\installer\welcome-1.bmp"
    File /oname=$PLUGINSDIR\tds-welcome-2.bmp "${BUILD_RESOURCES_DIR}\installer\welcome-2.bmp"
    File /oname=$PLUGINSDIR\tds-welcome-3.bmp "${BUILD_RESOURCES_DIR}\installer\welcome-3.bmp"
    File /oname=$PLUGINSDIR\tds-welcome-4.bmp "${BUILD_RESOURCES_DIR}\installer\welcome-4.bmp"
    File /oname=$PLUGINSDIR\tds-welcome-5.bmp "${BUILD_RESOURCES_DIR}\installer\welcome-5.bmp"
  ${EndIf}
!macroend

!macro customWelcomePage
  Page custom TdsWelcomeCreate TdsWelcomeLeave
!macroend

!macro customFinishPage
  Page custom TdsFinishCreate TdsFinishLeave
!macroend

Function TdsWelcomeTick
  IntOp $TdsWelcomeFrame $TdsWelcomeFrame + 1
  ${If} $TdsWelcomeFrame > 5
    StrCpy $TdsWelcomeFrame 0
  ${EndIf}
  ${NSD_SetImage} $TdsWelcomeImage "$PLUGINSDIR\tds-welcome-$TdsWelcomeFrame.bmp" $0
  ${If} $TdsWelcomeHandle != 0
    System::Call 'gdi32::DeleteObject(p$TdsWelcomeHandle)'
  ${EndIf}
  StrCpy $TdsWelcomeHandle $0
FunctionEnd

Function TdsFinishTick
  IntOp $TdsFinishFrame $TdsFinishFrame + 1
  ${If} $TdsFinishFrame > 5
    StrCpy $TdsFinishFrame 0
  ${EndIf}
  ${NSD_SetImage} $TdsFinishImage "$PLUGINSDIR\tds-welcome-$TdsFinishFrame.bmp" $0
  ${If} $TdsFinishHandle != 0
    System::Call 'gdi32::DeleteObject(p$TdsFinishHandle)'
  ${EndIf}
  StrCpy $TdsFinishHandle $0
FunctionEnd

Function TdsWelcomeCreate
  nsDialogs::Create 1018
  Pop $TdsWelcomeDialog
  ${If} $TdsWelcomeDialog == error
    Abort
  ${EndIf}

  SetCtlColors $TdsWelcomeDialog 0x${TDS_INK} 0x${TDS_DARK}
  ${NSD_CreateLabel} 0u 0u 100% 100% ""
  Pop $0
  SetCtlColors $0 0x${TDS_DARK} 0x${TDS_DARK}

  ${NSD_CreateBitmap} 0u 0u 109u 130u ""
  Pop $TdsWelcomeImage
  StrCpy $TdsWelcomeFrame 0
  ${NSD_SetImage} $TdsWelcomeImage "$PLUGINSDIR\tds-welcome-0.bmp" $TdsWelcomeHandle

  ${NSD_CreateLabel} 120u 7u 195u 12u "TDS COMPANION  /  KURULUM"
  Pop $0
  SetCtlColors $0 0x${TDS_BRAND} 0x${TDS_DARK}
  CreateFont $1 "$(^Font)" "8" "700"
  SendMessage $0 ${WM_SETFONT} $1 0

  ${NSD_CreateLabel} 120u 22u 195u 18u "Stratejin hazır."
  Pop $0
  SetCtlColors $0 0x${TDS_INK} 0x${TDS_DARK}
  CreateFont $1 "$(^Font)" "16" "700"
  SendMessage $0 ${WM_SETFONT} $1 0

  ${NSD_CreateLabel} 120u 43u 195u 20u "Roblox Tower Defense Simulator için masaüstü strateji yardımcısı."
  Pop $0
  SetCtlColors $0 0x${TDS_MUTE} 0x${TDS_DARK}
  CreateFont $1 "$(^Font)" "9" "400"
  SendMessage $0 ${WM_SETFONT} $1 0

  ${NSD_CreateLabel} 120u 72u 195u 38u "01  Belgeden adıma, tek ekranda$\r$\n02  Oyunun üstünde kalan overlay$\r$\n03  Keşfet, liderlik, profil ve VIP"
  Pop $0
  SetCtlColors $0 0x${TDS_INK} 0x${TDS_DARK}
  CreateFont $1 "$(^Font)" "9" "400"
  SendMessage $0 ${WM_SETFONT} $1 0

  ${NSD_CreateLabel} 120u 119u 195u 10u "Windows 10/11 · x64  ·  v${VERSION}"
  Pop $0
  SetCtlColors $0 0x${TDS_MUTE} 0x${TDS_DARK}
  CreateFont $1 "$(^Font)" "8" "400"
  SendMessage $0 ${WM_SETFONT} $1 0

  GetDlgItem $0 $HWNDPARENT 3
  ${If} $0 != 0
    ShowWindow $0 ${SW_HIDE}
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1
  ${If} $0 != 0
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Devam"
  ${EndIf}

  ${NSD_CreateTimer} TdsWelcomeTick 190
  nsDialogs::Show
  ${NSD_KillTimer} TdsWelcomeTick
  ${If} $TdsWelcomeHandle != 0
    System::Call 'gdi32::DeleteObject(p$TdsWelcomeHandle)'
  ${EndIf}
FunctionEnd

Function TdsWelcomeLeave
  ${NSD_KillTimer} TdsWelcomeTick
FunctionEnd

Function TdsFinishCreate
  nsDialogs::Create 1018
  Pop $TdsFinishDialog
  ${If} $TdsFinishDialog == error
    Abort
  ${EndIf}

  SetCtlColors $TdsFinishDialog 0x${TDS_INK} 0x${TDS_DARK}
  ${NSD_CreateLabel} 0u 0u 100% 100% ""
  Pop $0
  SetCtlColors $0 0x${TDS_DARK} 0x${TDS_DARK}

  ${NSD_CreateBitmap} 0u 0u 109u 130u ""
  Pop $TdsFinishImage
  StrCpy $TdsFinishFrame 3
  ${NSD_SetImage} $TdsFinishImage "$PLUGINSDIR\tds-welcome-3.bmp" $TdsFinishHandle

  ${NSD_CreateLabel} 120u 7u 195u 12u "TDS COMPANION  /  HAZIR"
  Pop $0
  SetCtlColors $0 0x${TDS_BRAND} 0x${TDS_DARK}
  CreateFont $1 "$(^Font)" "8" "700"
  SendMessage $0 ${WM_SETFONT} $1 0

  ${NSD_CreateLabel} 120u 22u 195u 18u "Kurulum tamamlandı."
  Pop $0
  SetCtlColors $0 0x${TDS_INK} 0x${TDS_DARK}
  CreateFont $1 "$(^Font)" "16" "700"
  SendMessage $0 ${WM_SETFONT} $1 0

  ${NSD_CreateLabel} 120u 43u 195u 26u "TDS Companion kullanıma hazır. İlk stratejini içe aktar, overlay'i aç ve oyuna dön."
  Pop $0
  SetCtlColors $0 0x${TDS_MUTE} 0x${TDS_DARK}
  CreateFont $1 "$(^Font)" "9" "400"
  SendMessage $0 ${WM_SETFONT} $1 0

  ${NSD_CreateCheckbox} 120u 82u 195u 12u "TDS Companion'ı şimdi başlat"
  Pop $TdsFinishRun
  SetCtlColors $TdsFinishRun 0x${TDS_INK} 0x${TDS_DARK}
  CreateFont $1 "$(^Font)" "9" "400"
  SendMessage $TdsFinishRun ${WM_SETFONT} $1 0
  ${NSD_Check} $TdsFinishRun

  ${NSD_CreateLabel} 120u 119u 195u 10u "Windows 10/11 · x64  ·  v${VERSION}"
  Pop $0
  SetCtlColors $0 0x${TDS_MUTE} 0x${TDS_DARK}
  CreateFont $1 "$(^Font)" "8" "400"
  SendMessage $0 ${WM_SETFONT} $1 0

  GetDlgItem $0 $HWNDPARENT 3
  ${If} $0 != 0
    ShowWindow $0 ${SW_HIDE}
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 2
  ${If} $0 != 0
    ShowWindow $0 ${SW_HIDE}
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1
  ${If} $0 != 0
    SendMessage $0 ${WM_SETTEXT} 0 "STR:Bitir"
  ${EndIf}

  ${NSD_CreateTimer} TdsFinishTick 190
  nsDialogs::Show
  ${NSD_KillTimer} TdsFinishTick
  ${If} $TdsFinishHandle != 0
    System::Call 'gdi32::DeleteObject(p$TdsFinishHandle)'
  ${EndIf}
FunctionEnd

Function TdsFinishLeave
  ${NSD_GetState} $TdsFinishRun $0
  ${If} $0 == ${BST_CHECKED}
    HideWindow
    ExecShell "open" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  ${EndIf}
FunctionEnd

!endif
