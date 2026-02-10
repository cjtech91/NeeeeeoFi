@echo off
set HWID=0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c
set KEY=NEO-TEST-KEY-1234
set URL=https://neofisystem.com/api/index.php?endpoint=activate

echo --- Test 1: data={...} ---
curl -k -d "data={\"key\":\"%KEY%\",\"machine_id\":\"%HWID%\",\"action\":\"activate\"}" "%URL%"
echo.
echo.

echo --- Test 2: json={...} ---
curl -k -d "json={\"key\":\"%KEY%\",\"machine_id\":\"%HWID%\",\"action\":\"activate\"}" "%URL%"
echo.
echo.

echo --- Test 3: payload={...} ---
curl -k -d "payload={\"key\":\"%KEY%\",\"machine_id\":\"%HWID%\",\"action\":\"activate\"}" "%URL%"
echo.
echo.

echo --- Test 4: request={...} ---
curl -k -d "request={\"key\":\"%KEY%\",\"machine_id\":\"%HWID%\",\"action\":\"activate\"}" "%URL%"
echo.
echo.
