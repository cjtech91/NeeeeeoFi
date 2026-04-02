<?php
$paths = [
  __DIR__.'/private.pem',
  __DIR__.'/private.key'
];
foreach ($paths as $p) {
  if (file_exists($p) && trim(file_get_contents($p)) !== '') {
    echo "FOUND: " . basename($p);
    exit;
  }
}
echo "NOT_FOUND";