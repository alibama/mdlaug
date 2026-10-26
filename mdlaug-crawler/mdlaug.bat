@echo off
rem mDLAUG crawler for Windows.   Usage:  .\mdlaug <command>
rem Start with:  .\mdlaug setup      List of commands:  .\mdlaug help
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows.ps1" %*
exit /b %ERRORLEVEL%
