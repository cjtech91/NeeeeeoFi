$url = "https://neofisystem.com/api/index.php"
$k = "NEO-TEST-KEY-1234"
$h = "0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c"
$model = "OrangePi Zero3"

Write-Host "--- Testing Pure GET Requests ---"

# 1. Standard Activation GET
$u1 = "$url?endpoint=activate&key=$k&machine_id=$h&device_model=$model"
try {
    $r1 = Invoke-WebRequest -Uri $u1 -Method Get -UseBasicParsing
    Write-Host "[GET Standard] $($r1.Content)"
} catch { Write-Host "[GET Standard] Error: $($_.Exception.Message)" }

# 2. Action Parameter GET
$u2 = "$url?action=activate&key=$k&machine_id=$h"
try {
    $r2 = Invoke-WebRequest -Uri $u2 -Method Get -UseBasicParsing
    Write-Host "[GET Action] $($r2.Content)"
} catch { Write-Host "[GET Action] Error: $($_.Exception.Message)" }

# 3. Hybrid (Endpoint + Action)
$u3 = "$url?endpoint=activate&action=activate&key=$k&machine_id=$h"
try {
    $r3 = Invoke-WebRequest -Uri $u3 -Method Get -UseBasicParsing
    Write-Host "[GET Hybrid] $($r3.Content)"
} catch { Write-Host "[GET Hybrid] Error: $($_.Exception.Message)" }

# 4. JSON in GET param (Manual encode)
$json = '{"key":"' + $k + '","machine_id":"' + $h + '"}'
# Simple URL encoding for quotes and braces
$jsonEncoded = $json -replace '"', '%22' -replace '{', '%7B' -replace '}', '%7D'
$u4 = "$url?endpoint=activate&data=$jsonEncoded"
try {
    $r4 = Invoke-WebRequest -Uri $u4 -Method Get -UseBasicParsing
    Write-Host "[GET JSON] $($r4.Content)"
} catch { Write-Host "[GET JSON] Error: $($_.Exception.Message)" }
