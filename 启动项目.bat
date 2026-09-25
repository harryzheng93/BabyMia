@echo off
setlocal

cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 goto node_error

for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto node_error
if %NODE_MAJOR% LSS 22 goto node_error

where npm.cmd >nul 2>&1
if errorlevel 1 goto npm_error

set "PORT=8185"
echo Starting BabyMia...
echo Open http://127.0.0.1:%PORT%/ in your browser.
echo.

call npm.cmd start

if errorlevel 1 (
  echo.
  echo BabyMia failed to start. Check the error message above.
  echo If the port is unavailable, run: set PORT=8285 ^&^& npm.cmd start
  pause
  exit /b 1
)

endlocal
exit /b 0

:node_error
echo Node.js 22 or newer was not found.
echo Install Node.js 22+, then run this script again.
pause
exit /b 1

:npm_error
echo npm.cmd was not found. Repair the Node.js installation and try again.
pause
exit /b 1
