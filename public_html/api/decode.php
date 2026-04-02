<?php
$f = __DIR__ . '/private.pem.b64';
if (!file_exists($f)) { echo "NO_B64"; exit; }
$d = base64_decode(file_get_contents($f), true);
if ($d === false) { echo "B64_FAIL"; exit; }
file_put_contents(__DIR__ . '/private.pem', $d);
echo "OK";