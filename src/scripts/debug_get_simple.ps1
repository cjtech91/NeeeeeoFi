$k = "NEO-TEST-KEY-1234"
$h = "0d9b014325996864f24d4427270db96dac07d62128eecca6ed448dec3030571c"
$u = "https://neofisystem.com/api/index.php?endpoint=activate&key=$k&machine_id=$h"

Write-Host "Testing URL: $u"
try {
    $r = Invoke-WebRequest -Uri $u -Method Get -UseBasicParsing
    Write-Host "Response: $($r.Content)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
