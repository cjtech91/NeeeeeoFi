$url = "https://neofisystem.com/api/index.php?endpoint=activate"
$k = "NEO-TEST-KEY-1234"
$h = "0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c"

$keyNames = @("key", "license_key", "license", "code", "serial", "activation_code", "token", "product_key", "id")
$hwidNames = @("machine_id", "hwid", "device_id", "mac_address", "mac", "serial_number", "cpu_id", "hardware_id")

Write-Host "Starting Fuzzing..."

foreach ($kn in $keyNames) {
    foreach ($hn in $hwidNames) {
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

Write-Host "Fuzzing Complete. No match found."
