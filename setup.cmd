@echo off
rem DrawingBoard one-command setup for Windows. Double-click this file, or run
rem   setup.cmd            start the editor
rem   setup.cmd --dev      also install the development dependencies
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "DEV="
set "FORWARD="
:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--dev"   ( set "DEV=1" & shift & goto parse )
if /i "%~1"=="--help"  ( goto usage )
if /i "%~1"=="-h"      ( goto usage )
set "FORWARD=!FORWARD! %1"
shift
goto parse
:parsed

echo ==^> Checking for Node.js
where node >nul 2>nul
if errorlevel 1 goto install_node
goto have_node

:install_node
echo     Node.js was not found.
where winget >nul 2>nul
if errorlevel 1 (
  echo     Install Node.js 20.11 or newer from https://nodejs.org/en/download
  echo     then run this script again.
  goto fail
)
set /p "REPLY=    Install it now with winget? [Y/n] "
if /i "!REPLY!"=="n" (
  echo     Install Node.js 20.11 or newer from https://nodejs.org/en/download
  echo     then run this script again.
  goto fail
)
echo ==^> Installing Node.js LTS
winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo     winget could not install Node.js. Install it from
  echo     https://nodejs.org/en/download and run this script again.
  goto fail
)
echo     Node.js is installed. Close this window, open a new one, and run setup.cmd again
echo     so the new PATH takes effect.
goto fail

:have_node
for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo     Found Node.js !NODE_VERSION!
for /f "tokens=1 delims=." %%a in ("!NODE_VERSION:v=!") do set "NODE_MAJOR=%%a"
if !NODE_MAJOR! LSS 20 (
  echo     Node.js 20.11 or newer is required. Upgrade from https://nodejs.org/en/download
  goto fail
)

if defined DEV (
  echo ==^> Installing development dependencies
  if exist package-lock.json (
    call npm ci --no-audit --no-fund
  ) else (
    call npm install --no-audit --no-fund
  )
  if errorlevel 1 (
    echo     Dependency install failed. The editor still runs without it.
    goto fail
  )
  echo ==^> Installing the Chromium build used by the browser tests
  call npx playwright install chromium
  echo     Run "npm test" and "npm run test:e2e" when you want the suites.
)

echo ==^> Starting DrawingBoard
node scripts\serve.mjs!FORWARD!
goto end

:usage
echo Usage: setup.cmd [OPTIONS]
echo.
echo   Serve DrawingBoard and open it in your browser. Installs nothing by default.
echo.
echo Options:
echo   --dev          Also install the development dependencies for the test suites.
echo   --port PORT    Serve on PORT instead of 4173.
echo   --no-open      Start the server without opening a browser.
echo   --help, -h     Show this message and exit.
goto end

:fail
echo.
echo Setup did not finish.
if /i "%~0"=="%~dpnx0" pause
exit /b 1

:end
endlocal
