@echo off
taskkill /f /im php.exe >nul 2>&1
echo Servidor do PDV desligado.
timeout /t 2 >nul
