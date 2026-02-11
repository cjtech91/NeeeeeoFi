
$file = "c:\Users\CJTECH NADS\Desktop\NeeeeeoFi\NeeeeeoFi\public\admin.html"
# Read with UTF8 encoding to ensure we handle special characters correctly
$content = Get-Content -Path $file -Raw -Encoding UTF8

# Replace Mojibake with Peso sign
# Note: In PowerShell, we might need to be careful with string literals for special chars.
# â‚± is likely what we see when UTF-8 bytes for ₱ (E2 82 B1) are interpreted as Windows-1252 or similar.
$content = $content.Replace('â‚±', '₱')

# Save file with UTF8 encoding
Set-Content -Path $file -Value $content -Encoding UTF8
Write-Host "Peso signs restored."
