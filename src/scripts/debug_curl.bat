@echo off
echo --- Test 1: Multipart Form (Original URL) ---
curl -k -F "key=TEST_KEY" -F "machine_id=TEST_HWID" "https://neofisystem.com/api/index.php?endpoint=activate"
echo.
echo.

echo --- Test 2: Multipart Form (endpoint in body) ---
curl -k -F "endpoint=activate" -F "key=TEST_KEY" -F "machine_id=TEST_HWID" "https://neofisystem.com/api/index.php"
echo.
echo.

echo --- Test 3: JSON to /api/activate ---
curl -k -X POST -H "Content-Type: application/json" -d "{\"key\":\"TEST_KEY\", \"hwid\":\"TEST_HWID\"}" "https://neofisystem.com/api/activate"
echo.
echo.

echo --- Test 4: JSON to /api/license/activate ---
curl -k -X POST -H "Content-Type: application/json" -d "{\"key\":\"TEST_KEY\", \"hwid\":\"TEST_HWID\"}" "https://neofisystem.com/api/license/activate"
echo.
echo.

echo --- Test 5: Standard Form to Original URL ---
curl -k -d "key=TEST_KEY&machine_id=TEST_HWID" "https://neofisystem.com/api/index.php?endpoint=activate"
echo.
echo.
