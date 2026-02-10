$url = "https://neofisystem.com/api/index.php?endpoint=activate"
$k = "NEO-TEST-KEY-1234"
$h = "0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c"

$body = @{
    "key" = $k
    "machine_id" = $h
    "action" = "activate"
}

function Test-Header {
    param($Headers, $Desc)
    try {
        $response = Invoke-WebRequest -Uri $url -Method Post -Body $body -Headers $Headers -UseBasicParsing
        $c = $response.Content
        Write-Host "[$Desc] $c"
    } catch {
        Write-Host "[$Desc] ERROR: $($_.Exception.Message)"
    }
}

Write-Host "--- Testing Headers ---"

# 1. User-Agent: Chrome
$h1 = @{ "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36" }
Test-Header -Headers $h1 -Desc "Chrome UA"

# 2. Referer
$h2 = @{ "Referer" = "https://neofisystem.com/" }
Test-Header -Headers $h2 -Desc "Referer"

# 3. Origin
$h3 = @{ "Origin" = "https://neofisystem.com" }
Test-Header -Headers $h3 -Desc "Origin"

# 4. X-Requested-With
$h4 = @{ "X-Requested-With" = "XMLHttpRequest" }
Test-Header -Headers $h4 -Desc "X-Requested-With"

# 5. Content-Type: application/json (Simulated via curl for precision)
Write-Host "[JSON Content-Type Check]"
$json = '{"key":"' + $k + '","machine_id":"' + $h + '","endpoint":"activate"}'
try {
    $r = Invoke-WebRequest -Uri $url -Method Post -Body $json -ContentType "application/json" -UseBasicParsing
    Write-Host "JSON POST: $($r.Content)"
} catch {
    Write-Host "JSON POST ERROR: $($_.Exception.Message)"
}
