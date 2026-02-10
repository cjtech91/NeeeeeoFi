@echo off
cd neofisystem_web
if not exist node_modules call npm install
node generate_license.js
pause
