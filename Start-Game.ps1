param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$koaRoot = $PSScriptRoot
$koaUrl = 'http://127.0.0.1:4317/'
$koaData = Join-Path $env:LOCALAPPDATA 'Koa'
$koaModel = Join-Path $koaData 'models\Qwen3-4B-Q4_K_M.gguf'
if (-not (Test-Path -LiteralPath $koaModel)) { $koaModel = Join-Path $koaData 'models\qwen2.5-1.5b-instruct-q4_k_m.gguf' }
$koaRuntime = Join-Path $koaData 'runtime-b11703'
$koaPidFile = Join-Path $koaData 'processes.json'
$koaNode = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $koaNode) {
    $koaBundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $koaBundledNode) { $koaNode = $koaBundledNode }
}
if (-not $koaNode) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Koa needs Node.js 22 or newer. Open the private web version instead, or install Node.js from nodejs.org.', 'Koa') | Out-Null
    exit 1
}
function Test-Koa {
    try {
        $koaStatus = Invoke-RestMethod -Uri ($koaUrl + 'api/status') -TimeoutSec 1
        return $null -ne $koaStatus.configured
    } catch { return $false }
}
$koaPids = @{ game = $null; ai = $null }
if (Test-Path -LiteralPath $koaPidFile) {
    try { $koaPrevious = Get-Content -LiteralPath $koaPidFile -Raw | ConvertFrom-Json; $koaPids.game = $koaPrevious.game; $koaPids.ai = $koaPrevious.ai } catch { }
}
$koaAiExe = if (Test-Path -LiteralPath $koaRuntime) { Get-ChildItem -LiteralPath $koaRuntime -Filter llama-server.exe -File -Recurse | Select-Object -ExpandProperty FullName -First 1 }
if ($koaAiExe -and (Test-Path -LiteralPath $koaModel)) {
    $koaAiReady = $false
    $koaAiProcess = $null
    # A busy computer can miss the health deadline while its model is still
    # running. Reuse only our tracked process at the expected runtime path.
    if ($koaPids.ai) {
        try {
            $koaTrackedAi = Get-Process -Id ([int]$koaPids.ai) -ErrorAction Stop
            $koaExpectedAiPath = [System.IO.Path]::GetFullPath($koaAiExe)
            if (-not $koaTrackedAi.HasExited -and $koaTrackedAi.Path -and
                [System.IO.Path]::GetFullPath($koaTrackedAi.Path).Equals($koaExpectedAiPath, [System.StringComparison]::OrdinalIgnoreCase)) {
                $koaAiProcess = $koaTrackedAi
            }
        } catch { }
        if (-not $koaAiProcess) { $koaPids.ai = $null }
    }
    try { $koaAiReady = (Invoke-RestMethod 'http://127.0.0.1:4318/health' -TimeoutSec 2).status -eq 'ok' } catch { }
    if (-not $koaAiReady) {
        if (-not $koaAiProcess) {
            $koaAiProcess = Start-Process -FilePath $koaAiExe -ArgumentList @('-m', ('"' + $koaModel + '"'), '--host', '127.0.0.1', '--port', '4318', '-c', '8192', '-t', '4', '--n-gpu-layers', '0', '--parallel', '1', '--log-verbosity', '1') -WorkingDirectory $koaData -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $koaData 'ai.log') -RedirectStandardError (Join-Path $koaData 'ai-error.log')
            $koaPids.ai = $koaAiProcess.Id
        }
        for ($koaWait = 0; $koaWait -lt 45; $koaWait++) {
            try { if ((Invoke-RestMethod 'http://127.0.0.1:4318/health' -TimeoutSec 1).status -eq 'ok') { $koaAiReady = $true; break } } catch { }
            Start-Sleep -Milliseconds 500
        }
    }
    # Configure the game for a verified running runtime even while it warms up;
    # /api/status independently reports readiness from the model health check.
    if ($koaAiReady -or ($koaAiProcess -and -not $koaAiProcess.HasExited)) { $env:KOA_LOCAL_AI_URL = 'http://127.0.0.1:4318' }
}
if (-not (Test-Koa)) {
    $koaGameProcess = Start-Process -FilePath $koaNode -ArgumentList @(('"' + (Join-Path $koaRoot 'server.mjs') + '"')) -WorkingDirectory $koaRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $koaRoot 'koa-server.log') -RedirectStandardError (Join-Path $koaRoot 'koa-server-error.log')
    $koaPids.game = $koaGameProcess.Id
    for ($koaAttempt = 0; $koaAttempt -lt 20; $koaAttempt++) {
        if (Test-Koa) { break }
        Start-Sleep -Milliseconds 250
    }
}
New-Item -ItemType Directory -Path $koaData -Force | Out-Null
$koaPids | ConvertTo-Json | Set-Content -LiteralPath $koaPidFile -Encoding UTF8
if (Test-Koa) { if (-not $NoBrowser) { Start-Process $koaUrl } } else {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('Koa could not open its local game. Please check koa-server-error.log or open the private web version.', 'Koa') | Out-Null
    exit 1
}
