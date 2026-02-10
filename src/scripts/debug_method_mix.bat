@echo off
set HWID=0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c
set KEY=NEO-TEST-KEY-1234

echo --- Test 1: POST with Params in URL ---
curl -k -X POST "https://neofisystem.com/api/index.php?endpoint=activate&key=%KEY%&machine_id=%HWID%" -d "dummy=1"
echo.
echo.

echo --- Test 2: POST with Params in URL (No Body) ---
curl -k -X POST "https://neofisystem.com/api/index.php?endpoint=activate&key=%KEY%&machine_id=%HWID%"
echo.
echo.

echo --- Test 3: PUT with Params in URL ---
curl -k -X PUT "https://neofisystem.com/api/index.php?endpoint=activate&key=%KEY%&machine_id=%HWID%"
echo.
echo.
