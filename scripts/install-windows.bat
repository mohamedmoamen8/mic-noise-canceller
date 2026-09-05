@echo off
setlocal enabledelayedexpansion

echo ============================================
echo  Mic Noise Canceller - Windows Installer
echo ============================================
echo.

set "GH_REPO=mohamedmoamen8/mic-noise-canceller"
set "EXT_DIR=%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions\mic-noise-canceller"
set "TEMP_ZIP=%TEMP%\mic-noise-canceller.zip"

echo Downloading latest release from GitHub...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/%GH_REPO%/releases/latest/download/mic-noise-canceller.zip' -OutFile '%TEMP_ZIP%'"

if not exist "%TEMP_ZIP%" (
    echo ERROR: Failed to download release. Check your internet connection and try again.
    pause
    exit /b 1
)

echo.
echo Extracting extension files...
set "INSTALL_DIR=%LOCALAPPDATA%\mic-noise-canceller"
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
mkdir "%INSTALL_DIR%" 2>nul

powershell -Command "Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%INSTALL_DIR%' -Force"

if errorlevel 1 (
    echo ERROR: Failed to extract zip.
    pause
    exit /b 1
)

echo.
echo Opening Chrome extensions page...
echo.
echo Instructions:
echo   1. Enable "Developer mode" (toggle in the top-right)
echo   2. Click "Load unpacked"
echo   3. Select the folder: %INSTALL_DIR%
echo   4. Toggle "Noise reduction" on in the popup
echo.

start chrome "chrome://extensions/"

echo.
echo Install folder: %INSTALL_DIR%
echo.
echo Done! If Chrome did not open automatically, navigate to chrome://extensions
pause
