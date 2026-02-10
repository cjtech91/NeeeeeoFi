$KEY = "NEO-2026-IFX6-6EPS"
$HWID = "0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c"
$MODEL = "OrangePi Zero3"
$URL_BASE = "https://neofisystem.com/api/index.php"

$key_names = @("key", "license", "license_key", "token", "api_key")
$mid_names = @("machine_id", "machineid", "hwid", "hardware_id", "device_id")

function Test-Req {
    param ($Url, $Method, $Body, $ContentType, $Desc)
    
    try {
        $params = @{
            Uri = $Url
            Method = $Method
            UseBasicParsing = $true
        }
        $resp = Invoke-WebRequest @params
        $c = $resp.Content
        if ($c -notmatch "Missing key or machine ID" -and $c -notmatch "NeoFi License API") {
            Write-Host "SUCCESS [$Desc]: $c" -ForegroundColor Green
        } elseif ($c -match "Missing key or machine ID") {
            Write-Host "MISSING [$Desc]" -ForegroundColor Yellow
        } else {
            Write-Host "WELCOME [$Desc]" -ForegroundColor Cyan
        }
    } catch {
        $msg = $_.Exception.Message
        if ($_.Exception.Response) {
             $reader = New-Object System.IO.StreamReader $_.Exception.Response.GetResponseStream()
             $txt = $reader.ReadToEnd()
             Write-Host "ERROR [$Desc]: $txt" -ForegroundColor Red
        } else {
             Write-Host "EXCEPTION [$Desc]: $msg" -ForegroundColor Red
        }
    }
}

Write-Host "Starting Brute Force GET..."

foreach ($k in $key_names) {
    foreach ($m in $mid_names) {
        # endpoint=activate
        $u = "${URL_BASE}?endpoint=activate&${k}=${KEY}&${m}=${HWID}"
        Test-Req -Url $u -Method "GET" -Desc "GET endpoint=activate $k $m"
        
        # action=activate
        $u2 = "${URL_BASE}?action=activate&${k}=${KEY}&${m}=${HWID}"
        Test-Req -Url $u2 -Method "GET" -Desc "GET action=activate $k $m"
    }
}
