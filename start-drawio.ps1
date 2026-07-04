$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root "drawio\company-server"

if (-not $env:HOST) {
    $env:HOST = "127.0.0.1"
}

if (-not $env:PORT) {
    $env:PORT = "8081"
}

Write-Host "Starting Company Draw login server..."
Write-Host "Login URL: http://127.0.0.1:$env:PORT/login.html"

Push-Location $server
try {
    node .\server.js
}
finally {
    Pop-Location
}
