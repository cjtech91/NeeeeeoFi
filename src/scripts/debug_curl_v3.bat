@echo off
set HWID=0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c
set KEY=NEO-TEST-KEY-1234

echo --- Test 1: Verbose + Follow Redirects ---
curl -v -L -A "Mozilla/5.0" -d "key=%KEY%&machine_id=%HWID%&action=activate" "https://neofisystem.com/api/index.php?endpoint=activate" 2>&1
echo.
echo.
