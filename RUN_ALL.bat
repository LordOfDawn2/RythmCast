@echo off
title RythmCast - Server
setlocal

cd /d "%~dp0server"
call npm.cmd start

pause


