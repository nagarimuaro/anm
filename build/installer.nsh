; =============================================
; SINTA Kiosk — Custom NSIS Installer Script
; Force-kill running processes before install/uninstall
; =============================================

!macro customInit
  ; Bunuh paksa SINTA.exe yang sedang berjalan sebelum install
  nsExec::ExecToLog 'taskkill /F /IM "SINTA.exe" /T'
  Sleep 1000
!macroend

!macro customUnInit  
  ; Bunuh paksa SINTA.exe yang sedang berjalan sebelum uninstall
  nsExec::ExecToLog 'taskkill /F /IM "SINTA.exe" /T'
  Sleep 1000
!macroend

!macro customInstallMode
  ; Instal untuk user saat ini saja (tidak butuh admin)
  StrCpy $isForceCurrentInstall "1"
!macroend
