$url = "https://neofisystem.com/api/index.php?endpoint=activate"
$k = "NEO-TEST-KEY-1234"
$h = "0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c"

$keyCases = @("Key", "KEY", "LicenseKey", "License_Key", "ActivationKey")
$hwidCases = @("MachineID", "MachineId", "HWID", "Hwid", "DeviceID", "DeviceId")

Write-Host "Starting Case Fuzzing..."

foreach ($kn in $keyCases) {
    foreach ($hn in $hwidCases) {
        $body = "$kn=$k&$hn=$h&action=activate"
        try {
            $response = Invoke-WebRequest -Uri $url -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -UseBasicParsing
            $content = $response.Content
            if ($content -notlike "*Missing key or machine ID*") {
                Write-Host "FOUND MATCH! Key: $kn, HWID: $hn"
                Write-Host "Response: $content"
                exit
            }
        } catch {
            Write-Host "Error with $kn / $hn"
        }
    }
}

Write-Host "Case Fuzzing Complete. No match found."
