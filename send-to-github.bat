@echo off
cd /d "%~dp0"
git config user.name >NUL 2>&1 || git config --global user.name "evdokimovd809"
git config user.email >NUL 2>&1 || git config --global user.email "evdokimovd809@users.noreply.github.com"
echo.
echo === Sending changes to GitHub ===
git add -A
git commit -m "Update %date% %time%"
git push
echo.
if errorlevel 1 (echo ERROR: something went wrong, send a screenshot to Claude) else (echo DONE: the bot will update in 1-2 minutes)
pause
