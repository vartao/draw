$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $root "serve_drawio.py"

python $script --host 127.0.0.1 --port 8080
