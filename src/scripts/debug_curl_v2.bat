@echo off
set HWID=0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c
set KEY=NEO-TEST-KEY-1234

echo --- Test 1: Form Data with Real-looking Data ---
curl -k -d "key=%KEY%&machine_id=%HWID%" "https://neofisystem.com/api/index.php?endpoint=activate"
echo.
echo.

echo --- Test 2: JSON with Real-looking Data ---
curl -k -X POST -H "Content-Type: application/json" -d "{\"key\":\"%KEY%\", \"machine_id\":\"%HWID%\"}" "https://neofisystem.com/api/index.php?endpoint=activate"
echo.
echo.

echo --- Test 3: Form Data with 'license_key' and 'hwid' ---
curl -k -d "license_key=%KEY%&hwid=%HWID%" "https://neofisystem.com/api/index.php?endpoint=activate"
echo.
echo.

echo --- Test 4: JSON with 'license_key' and 'hwid' ---
curl -k -X POST -H "Content-Type: application/json" -d "{\"license_key\":\"%KEY%\", \"hwid\":\"%HWID%\"}" "https://neofisystem.com/api/index.php?endpoint=activate"
echo.
echo.
