@echo off
title Ori's Space Party - keep this window open
echo Starting Ori's Space Party...
echo   Big screen: http://localhost:8765/
echo   Host page:  http://localhost:8765/host.html
echo Keep this window open during the party. Close it when you are done.
start "" http://localhost:8765/host.html
start "" http://localhost:8765/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Root "%~dp0."
