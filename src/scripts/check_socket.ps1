$port = 3000
$process = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue

if ($process) {
    Write-Host "Port $port is LISTENING." -ForegroundColor Green
    $process | Select-Object LocalAddress, LocalPort, State, OwningProcess | Format-Table
} else {
    Write-Host "Port $port is NOT listening." -ForegroundColor Red
}

Write-Host "--- Testing HTTP Connection to localhost:$port ---"
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:$port/socket.io/?EIO=4&transport=polling" -UseBasicParsing
    Write-Host "Socket.IO Polling Status: $($resp.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($resp.Content)"
} catch {
    Write-Host "HTTP Connection Failed: $($_.Exception.Message)" -ForegroundColor Red
}
