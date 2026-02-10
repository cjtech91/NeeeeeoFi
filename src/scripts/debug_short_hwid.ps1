$url = "https://neofisystem.com/api/index.php?endpoint=activate"
$k = "NEO-TEST-KEY-1234"
$h = "test-hwid"

Write-Host "--- Testing Short HWID ---"
$body = "key=$k&machine_id=$h"
try {
    $r = Invoke-WebRequest -Uri $url -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -UseBasicParsing
    Write-Host "Response: $($r.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
