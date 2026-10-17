$koaData = Join-Path $env:LOCALAPPDATA 'Koa'
$koaPidFile = Join-Path $koaData 'processes.json'
if (-not (Test-Path -LiteralPath $koaPidFile)) { exit 0 }
try { $koaPids = Get-Content -LiteralPath $koaPidFile -Raw | ConvertFrom-Json } catch { exit 0 }
foreach ($koaEntry in @(@{ id=$koaPids.game; kind='game' }, @{ id=$koaPids.ai; kind='ai' })) {
    if (-not $koaEntry.id) { continue }
    $koaProcess = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$koaEntry.id) -ErrorAction SilentlyContinue
    if (-not $koaProcess) { continue }
    if ($koaEntry.kind -eq 'game') {
        $koaGameScript = Join-Path $PSScriptRoot 'server.mjs'
        if ($koaProcess.Name -eq 'node.exe' -and $koaProcess.CommandLine.Contains($koaGameScript)) { Stop-Process -Id $koaProcess.ProcessId -ErrorAction SilentlyContinue }
    } else {
        if ($koaProcess.ExecutablePath -and $koaProcess.ExecutablePath.StartsWith((Join-Path $koaData 'runtime-b11703\'), [StringComparison]::OrdinalIgnoreCase) -and $koaProcess.Name -eq 'llama-server.exe') { Stop-Process -Id $koaProcess.ProcessId -ErrorAction SilentlyContinue }
    }
}
