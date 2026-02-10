$url = "https://neofisystem.com/api/index.php?endpoint=activate"
$k = "NEO-TEST-KEY-1234"
$h = "0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c"

function Test-Post {
    param($Body, $Desc)
    try {
        $response = Invoke-WebRequest -Uri $url -Method Post -Body $Body -UseBasicParsing
        $c = $response.Content
        Write-Host "[$Desc] Status: $($response.StatusCode)"
        if ($c -match "Missing key") {
            Write-Host "  -> FAIL: Missing key" -ForegroundColor Yellow
        } else {
            Write-Host "  -> SUCCESS/DIFF: $c" -ForegroundColor Green
        }
    } catch {
        Write-Host "[$Desc] ERROR: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response) {
             $reader = New-Object System.IO.StreamReader $_.Exception.Response.GetResponseStream()
             Write-Host "  -> RESP: $($reader.ReadToEnd())"
        }
    }
}

Write-Host "--- Testing Nested Form Data ---"

# 1. data[key]
$b1 = @{
    "data[key]" = $k
    "data[machine_id]" = $h
}
Test-Post -Body $b1 -Desc "data[key]"

# 2. license[key]
$b2 = @{
    "license[key]" = $k
    "license[machine_id]" = $h
}
Test-Post -Body $b2 -Desc "license[key]"

# 3. user[key]
$b3 = @{
    "user[key]" = $k
    "user[machine_id]" = $h
}
Test-Post -Body $b3 -Desc "user[key]"

# 4. JSON as string in 'data' param
$json = '{"key":"' + $k + '","machine_id":"' + $h + '"}'
$b4 = @{
    "data" = $json
}
Test-Post -Body $b4 -Desc "data=JSON_STRING"

# 5. Mixed: key in URL, machine_id in body
$urlMixed = "$url&key=$k"
try {
    $resp = Invoke-WebRequest -Uri $urlMixed -Method Post -Body @{ "machine_id" = $h } -UseBasicParsing
    Write-Host "[Mixed URL/Body] $resp.Content"
} catch { Write-Host "[Mixed] Error" }
