@echo off
title NeoFi Build Script
cls
echo ==========================================
echo      NEOFI WEBSITE BUILDER FOR XAMPP
echo ==========================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [CRITICAL ERROR] Node.js is NOT installed or not found in PATH.
    echo.
    echo You CANNOT build this website without Node.js.
    echo.
    echo Please download and install it from: https://nodejs.org/
    echo (Install the "LTS" version, then restart your computer)
    echo.
    pause
    exit /b
)

echo [OK] Node.js found.
echo.
echo 1. Installing dependencies (this may take a few minutes)...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b
)

echo.
echo 2. Building project...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed.
    pause
    exit /b
)

echo.
echo ==========================================
echo      BUILD SUCCESSFUL!
echo ==========================================
echo.
echo Now do the following:
echo 1. Go to the 'dist' folder inside this project.
echo 2. Copy ALL files inside 'dist'.
echo 3. Paste them into C:\xampp\htdocs\neofi
echo.
pause
