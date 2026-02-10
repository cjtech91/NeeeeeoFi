$url = "https://neofisystem.com/api/index.php"
Write-Host "--- Test 1: Endpoint in Body ---"
try {
    $body = "endpoint=activate&action=activate&key=TEST_KEY&machine_id=TEST_HWID"
    $response = Invoke-WebRequest -Uri $url -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)"
    Write-Host "Content: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

$url2 = "https://neofisystem.com/api/"
Write-Host "`n--- Test 2: POST to /api/ ---"
try {
    $body = "endpoint=activate&action=activate&key=TEST_KEY&machine_id=TEST_HWID"
    $response = Invoke-WebRequest -Uri $url2 -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)"
    Write-Host "Content: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
