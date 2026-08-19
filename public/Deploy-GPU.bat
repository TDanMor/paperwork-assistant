@echo off
title Browser GPU Deployer

echo Closing active browsers to apply GPU settings...

taskkill /F /IM msedge.exe >nul 2>&1
taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /IM brave.exe >nul 2>&1

echo Relaunching browsers with forced Hardware Acceleration...

if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --enable-hardware-acceleration --ignore-gpu-blocklist --force-webgl
) else if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files\Microsoft\Edge\Application\msedge.exe" --enable-hardware-acceleration --ignore-gpu-blocklist --force-webgl
)

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --enable-hardware-acceleration --ignore-gpu-blocklist --force-webgl
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --enable-hardware-acceleration --ignore-gpu-blocklist --force-webgl
)

if exist "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" (
    start "" "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --enable-hardware-acceleration --ignore-gpu-blocklist --force-webgl
) else if exist "C:\Users\%USERNAME%\AppData\Local\BraveSoftware\Brave-Browser\Application\brave.exe" (
    start "" "C:\Users\%USERNAME%\AppData\Local\BraveSoftware\Brave-Browser\Application\brave.exe" --enable-hardware-acceleration --ignore-gpu-blocklist --force-webgl
)

echo.
echo GPU browser configuration applied.
echo Please return to the application and run the GPU check again.

exit
