# mDLAUG crawler for Windows; mdlaug.bat calls this. Usage:  .\mdlaug <command>
$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"          # UTF-8 everywhere, so logs with accented names don't break
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Py = Join-Path $Root ".venv\Scripts\python.exe"
$Cmd = if ($args.Count -gt 0) { $args[0] } else { "help" }

if ($Cmd -eq "setup") {
    # uv installs Python and the libraries into a private folder (.venv) here.
    $Uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
    $Local = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
    if (-not $Uv -and (Test-Path $Local)) { $Uv = $Local }
    if (-not $Uv) {
        Write-Host "== Installing uv (it installs Python for this project)"
        powershell -NoProfile -ExecutionPolicy ByPass -Command "irm https://astral.sh/uv/install.ps1 | iex"
        $Uv = $Local
    }
    if (-not (Test-Path $Py)) {
        Write-Host "== Creating the Python environment"
        & $Uv venv --python 3.12 .venv
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    Write-Host "== Installing libraries (a minute or two the first time)"
    & $Uv pip install --python $Py -r requirements.txt -r requirements-analysis.txt pytest
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if (-not (Test-Path $Py)) {
    Write-Host "Not set up yet. Run this first:   .\mdlaug setup"
    exit 1
}
& $Py scripts\helper.py @args
exit $LASTEXITCODE
