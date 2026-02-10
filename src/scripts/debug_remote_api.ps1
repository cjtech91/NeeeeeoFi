$url = "https://neofisystem.com/api/index.php?endpoint=activate"
$key = "TEST_KEY_12345"
$hwid = "TEST_HWID_12345"

Write-Host "--- Test 1: POST x-www-form-urlencoded ---"
try {
    $body = "key=$key&machine_id=$hwid&endpoint=activate"
    $response = Invoke-WebRequest -Uri $url -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)"
    Write-Host "Content: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader $_.Exception.Response.GetResponseStream()
        Write-Host "Response Body: $($reader.ReadToEnd())"
    }
}

Write-Host "`n--- Test 2: POST JSON ---"
try {
    $body = @{
        key = $key
        machine_id = $hwid
        endpoint = "activate"
    } | ConvertTo-Json
    $response = Invoke-WebRequest -Uri $url -Method Post -Body $body -ContentType "application/json" -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)"
    Write-Host "Content: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
     if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader $_.Exception.Response.GetResponseStream()
        Write-Host "Response Body: $($reader.ReadToEnd())"
    }
}

Write-Host "`n--- Test 3: POST with Params in URL (Empty Body) ---"
try {
    $urlParams = "$url&key=$key&machine_id=$hwid"
    $response = Invoke-WebRequest -Uri $urlParams -Method Post -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)"
    Write-Host "Content: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
     if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader $_.Exception.Response.GetResponseStream()
        Write-Host "Response Body: $($reader.ReadToEnd())"
    }
}

Write-Host "`n--- Test 4: GET with Params ---"
try {
    $urlParams = "$url&key=$key&machine_id=$hwid"
    $response = Invoke-WebRequest -Uri $urlParams -Method Get -UseBasicParsing
    Write-Host "Status: $($response.StatusCode)"
    Write-Host "Content: $($response.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
     if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader $_.Exception.Response.GetResponseStream()
        Write-Host "Response Body: $($reader.ReadToEnd())"
    }
}
