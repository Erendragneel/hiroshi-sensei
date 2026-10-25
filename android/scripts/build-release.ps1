$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$releaseVersion = [regex]::Match((Get-Content -LiteralPath 'app/build.gradle' -Raw), "versionName\s+'([^']+)'").Groups[1].Value
if (-not $releaseVersion -or $releaseVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'A valid Hiroshi release version is required in app/build.gradle.' }
$releaseApk = Join-Path 'artifacts' "hiroshi-sensei-$releaseVersion.apk"
$releaseBundle = Join-Path 'artifacts' "hiroshi-sensei-$releaseVersion.aab"
$toolRoot = Join-Path $env:LOCALAPPDATA 'LanguageMinerBuildTools'
$environmentNames = @('JAVA_HOME', 'ANDROID_HOME', 'JAVA_TOOL_OPTIONS', 'HIROSHI_TEST_MAVEN_REPO', 'HIROSHI_KEYSTORE', 'HIROSHI_STORE_PASSWORD', 'HIROSHI_KEY_PASSWORD', 'HIROSHI_KEY_ALIAS')
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    if (-not $env:JAVA_HOME) { $env:JAVA_HOME = (Get-ChildItem -LiteralPath (Join-Path $toolRoot 'java') -Directory | Select-Object -First 1).FullName }
    if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $toolRoot 'android-sdk' }
    if (-not $env:JAVA_TOOL_OPTIONS) { $env:JAVA_TOOL_OPTIONS = '-Djdk.net.unixdomain.tmpdir=C:/HiroshiSensei-Unavailable-Unix-Sockets' }
    if (-not $env:HIROSHI_TEST_MAVEN_REPO) {
        # Robolectric's Windows native loader needs a path without URL-encoded spaces.
        $mavenCache = Join-Path $env:USERPROFILE '.m2/repository'
        New-Item -ItemType Directory -Force -Path $mavenCache | Out-Null
        $fileSystem = New-Object -ComObject Scripting.FileSystemObject
        try { $env:HIROSHI_TEST_MAVEN_REPO = $fileSystem.GetFolder($mavenCache).ShortPath }
        finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($fileSystem) }
        if ($env:HIROSHI_TEST_MAVEN_REPO -match ' ') { throw 'Set HIROSHI_TEST_MAVEN_REPO to a Maven cache path without spaces for Android startup tests.' }
    }
    if (-not $env:HIROSHI_KEYSTORE) {
        & "$PSScriptRoot/create-upload-key.ps1"
        $keyRoot = Join-Path $env:LOCALAPPDATA 'HiroshiSenseiSigning'
        $secure = Get-Content -LiteralPath (Join-Path $keyRoot 'password.dpapi') | ConvertTo-SecureString
        $credential = [pscredential]::new('upload', $secure)
        $env:HIROSHI_KEYSTORE = Join-Path $keyRoot 'hiroshi-sensei.jks'
        $env:HIROSHI_STORE_PASSWORD = $credential.GetNetworkCredential().Password
        $env:HIROSHI_KEY_PASSWORD = $env:HIROSHI_STORE_PASSWORD
        $env:HIROSHI_KEY_ALIAS = 'hiroshi-sensei'
    }
    & ./gradlew.bat --no-daemon :app:testDebugUnitTest :app:lintRelease :app:assembleRelease :app:bundleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Hiroshi Android build failed.' }
    New-Item -ItemType Directory -Force -Path artifacts | Out-Null
    Copy-Item -LiteralPath app/build/outputs/apk/release/app-release.apk -Destination $releaseApk
    Copy-Item -LiteralPath app/build/outputs/bundle/release/app-release.aab -Destination $releaseBundle
    & (Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/apksigner.bat') verify --verbose $releaseApk
    if ($LASTEXITCODE -ne 0) { throw 'Hiroshi APK signature verification failed.' }
    $verificationPreference = $ErrorActionPreference
    try {
        # Windows PowerShell 5 treats redirected informational Java stderr as an error.
        # The native verifier's exit code remains authoritative.
        $ErrorActionPreference = 'Continue'
        & (Join-Path $env:JAVA_HOME 'bin/jarsigner.exe') -verify $releaseBundle *> artifacts/bundle-signature.txt
        $verificationExit = $LASTEXITCODE
    } finally { $ErrorActionPreference = $verificationPreference }
    if ($verificationExit -ne 0) { throw 'Hiroshi Android bundle signature verification failed.' }
    @($releaseApk, $releaseBundle) | ForEach-Object {
        $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256
        "$($hash.Hash.ToLower())  $([IO.Path]::GetFileName($_))"
    } | Set-Content -LiteralPath artifacts/SHA256SUMS.txt
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
    $credential = $null
    $secure = $null
}
