$url = "https://neofisystem.com/api/index.php?endpoint=activate"
$k = "TEST_KEY_12345"
$h = "TEST_HWID_12345"

function Test-Payload ($name, $body) {
    Write-Host "`n--- Test: $name ---"
    try {
        $response = Invoke-WebRequest -Uri $url -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -UseBasicParsing
        Write-Host "Content: $($response.Content)"
    } catch {
        Write-Host "Error: $($_.Exception.Message)"
    }
}

Test-Payload "key + machine_id" "key=$k&machine_id=$h"
Test-Payload "license_key + hwid" "license_key=$k&hwid=$h"
Test-Payload "key + hwid" "key=$k&hwid=$h"
Test-Payload "license_key + machine_id" "license_key=$k&machine_id=$h"
Test-Payload "Array Syntax" "data[key]=$k&data[machine_id]=$h"
Test-Payload "JSON String in 'data'" "data={""key"":""$k"",""machine_id"":""$h""}"
