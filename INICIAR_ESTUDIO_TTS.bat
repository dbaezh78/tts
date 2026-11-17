@echo off
title Noiz AI TTS Studio Local - dbaeztts
cd /d "%~dp0"
echo =============================================================
echo   INICIANDO NOIZ AI TTS STUDIO LOCAL (398+ VOCES)
echo   Abriendo http://localhost:3000 en tu navegador...
echo =============================================================
start http://localhost:3000
node server.js
pause
