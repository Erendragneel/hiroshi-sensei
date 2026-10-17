$ErrorActionPreference = 'Stop'
$koaData = Join-Path $env:LOCALAPPDATA 'Koa'
$koaRuntime = Join-Path $koaData 'runtime-b11703'
$koaModels = Join-Path $koaData 'models'
$koaZip = Join-Path $koaData 'llama-b11703-bin-win-cpu-x64.zip'
$koaModel = Join-Path $koaModels 'Qwen3-4B-Q4_K_M.gguf'
New-Item -ItemType Directory -Path $koaData,$koaRuntime,$koaModels -Force | Out-Null

function Get-KoaDownload([string]$Url,[string]$Target,[string]$Sha256) {
    if (Test-Path -LiteralPath $Target) {
        if ((Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Sha256) { return }
        throw "An existing Koa download has an unexpected checksum: $Target"
    }
    $koaPartial = $Target + '.partial'
    & curl.exe --location --fail --silent --show-error --retry 2 --connect-timeout 20 --speed-limit 1024 --speed-time 30 --output $koaPartial $Url
    if ($LASTEXITCODE -ne 0) { throw 'The Koa AI download did not finish. Run setup again when your connection is available.' }
    if ((Get-FileHash -LiteralPath $koaPartial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) {
        throw 'Koa could not verify the downloaded file. It has not been installed.'
    }
    Move-Item -LiteralPath $koaPartial -Destination $Target
}

Write-Output 'Downloading and verifying the portable AI runtime.'
Get-KoaDownload 'https://github.com/ggml-org/llama.cpp/releases/download/b11703/llama-b11703-bin-win-cpu-x64.zip' $koaZip 'cf3050ac140fb9d8c726cdea5e3c16b1879c86e41443aabb84c948e9e100b9de'
if (-not (Test-Path -LiteralPath (Join-Path $koaRuntime 'llama-server.exe'))) {
    Expand-Archive -LiteralPath $koaZip -DestinationPath $koaRuntime -Force
}
Write-Output 'Downloading and verifying the local conversation model (about 2.5 GB).'
Get-KoaDownload 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/bc640142c66e1fdd12af0bd68f40445458f3869b/Qwen3-4B-Q4_K_M.gguf?download=true' $koaModel '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5'
Write-Output 'The on-device AI is installed. Open Start Koa.cmd to play.'
