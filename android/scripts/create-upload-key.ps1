$ErrorActionPreference = 'Stop'
$toolRoot = Join-Path $env:LOCALAPPDATA 'LanguageMinerBuildTools'
$keyRoot = Join-Path $env:LOCALAPPDATA 'HiroshiSenseiSigning'
$javaRoot = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { (Get-ChildItem -LiteralPath (Join-Path $toolRoot 'java') -Directory | Select-Object -First 1).FullName }
$keytool = Join-Path $javaRoot 'bin/keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) { throw 'Install JDK 21 or set JAVA_HOME first.' }

New-Item -ItemType Directory -Force -Path $keyRoot | Out-Null
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $keyRoot '/inheritance:r' '/grant:r' "*${sid}:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict Hiroshi signing directory permissions.' }
$keystore = Join-Path $keyRoot 'hiroshi-sensei.jks'
$secret = Join-Path $keyRoot 'password.dpapi'
if (Test-Path -LiteralPath $keystore) {
    if (-not (Test-Path -LiteralPath $secret)) { throw 'Existing Hiroshi key has no local password record. Do not replace the key.' }
    Write-Output 'Existing Hiroshi signing key retained.'
    return
}
if (Test-Path -LiteralPath $secret) { throw 'Hiroshi password record exists without its key. Resolve manually; do not overwrite.' }

$bytes = New-Object byte[] 32
$random = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($bytes) } finally { $random.Dispose() }
$password = [Convert]::ToBase64String($bytes)
$password | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $secret
$previousPasswordEnv = $env:HIROSHI_KEYGEN_PASSWORD
try {
    $env:HIROSHI_KEYGEN_PASSWORD = $password
    & $keytool -genkeypair -keystore $keystore -storetype JKS -alias 'hiroshi-sensei' -keyalg RSA -keysize 4096 -validity 10000 -dname 'CN=Hiroshi sensei' -storepass:env HIROSHI_KEYGEN_PASSWORD -keypass:env HIROSHI_KEYGEN_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'Hiroshi key generation failed.' }
    & $keytool -exportcert -rfc -keystore $keystore -alias 'hiroshi-sensei' -storepass:env HIROSHI_KEYGEN_PASSWORD -file (Join-Path $keyRoot 'upload-certificate.pem')
    if ($LASTEXITCODE -ne 0) { throw 'Hiroshi signing certificate export failed.' }
} finally {
    if ($null -eq $previousPasswordEnv) { Remove-Item Env:HIROSHI_KEYGEN_PASSWORD -ErrorAction SilentlyContinue } else { $env:HIROSHI_KEYGEN_PASSWORD = $previousPasswordEnv }
    [Array]::Clear($bytes, 0, $bytes.Length)
    $password = $null
}
Write-Output 'Hiroshi signing key created outside the repository. Keep a secure backup of the key and recoverable password.'
