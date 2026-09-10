@echo off
setlocal
rem Works at the release root or from platform\Windows in a source checkout.
set "fecimus_root=%~dp0"
if not exist "%fecimus_root%scripts\install.ps1" set "fecimus_root=%~dp0..\..\"
if not exist "%fecimus_root%scripts\install.ps1" (
  echo Extract the complete Fecimus Windows release before running this launcher.
  set "fecimus_exit=1"
  goto finish
)
where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo Windows PowerShell is missing. Read START_HERE.md for prerequisites.
  set "fecimus_exit=1"
  goto finish
)
echo Fecimus for Windows 11 Pro runs inside an initialized Ubuntu LTS WSL2 distribution.
echo Your ordinary Linux user may be asked for its sudo password.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%fecimus_root%scripts\install.ps1" -InstallSystemDeps -ReplaceLegacy %*
set "fecimus_exit=%ERRORLEVEL%"
:finish
if not "%fecimus_exit%"=="0" echo Fecimus setup failed. Read the error above and START_HERE.md before retrying.
if not defined FECIMUS_NO_PAUSE pause
exit /b %fecimus_exit%
