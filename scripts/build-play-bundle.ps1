<#
.SYNOPSIS
  Build the signed Android App Bundle (.aab) that goes to Google Play.

.DESCRIPTION
  Three things on this Windows machine stop a release build, and none of them
  say so clearly (see BUILD.md):
    1. CMake/ninja refuse object paths over 260 characters, and the New
       Architecture codegen produces ~269. Only a genuinely short source path
       works, so the build runs from a mirror at C:\ss.
    2. local.properties is a Java properties file: a backslash path arrives
       mangled. It is written with forward slashes.
    3. robocopy's /XD matches a bare name anywhere in the tree (it would drop
       node_modules/@expo/config-plugins/build/android), so it gets absolute paths.

  The upload key is read by plugins/withReleaseSigning.js from
  %USERPROFILE%\.gradle\gradle.properties (SHATHI_UPLOAD_* entries). The build
  refuses to produce a bundle without it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-play-bundle.ps1
#>
$ErrorActionPreference = "Stop"

$Src     = Split-Path -Parent $PSScriptRoot           # the app repo
$Mirror  = "C:\ss"
$Out     = "C:\Apps\Digigram\ShathiSheba\Resources\play-store\releases"
$env:JAVA_HOME    = "C:\Program Files\Android\Android Studio\jbr"   # JDK 21; PATH java is 1.8
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

$gradleProps = "$env:USERPROFILE\.gradle\gradle.properties"
if (-not (Select-String -Path $gradleProps -Pattern "^SHATHI_UPLOAD_STORE_FILE=" -Quiet -ErrorAction SilentlyContinue)) {
  throw "The Play upload key is not configured in $gradleProps (SHATHI_UPLOAD_*). See plugins/withReleaseSigning.js."
}

$app = Get-Content "$Src\app.json" -Raw | ConvertFrom-Json
$version = $app.expo.version
$code    = $app.expo.android.versionCode
Write-Host "Building Shathi Sheba $version (versionCode $code)" -ForegroundColor Cyan
Write-Host "Reminder: every upload to Play needs a higher versionCode than the last one." -ForegroundColor Yellow

# 1. Mirror to the short path. android/ is regenerated below, so it is excluded.
robocopy $Src $Mirror /MIR /MT:16 /R:1 /W:1 /NFL /NDL /NP `
  /XD "$Src\android" "$Src\.expo" "$Src\design-system" "$Src\node_modules\.cache" "$Mirror\android" | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

# 2. Regenerate the native project from app.json + config plugins.
Push-Location $Mirror
$env:CI = "1"
npx expo prebuild --platform android --clean
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "expo prebuild failed" }
Set-Content -Path "$Mirror\android\local.properties" -Value "sdk.dir=$($env:ANDROID_HOME -replace '\\','/')" -Encoding ascii

# 3. Build the signed bundle.
Push-Location "$Mirror\android"
.\gradlew.bat bundleRelease --console=plain
$ok = $LASTEXITCODE -eq 0
Pop-Location; Pop-Location
if (-not $ok) { throw "gradlew bundleRelease failed" }

# 4. Keep a named copy of every bundle that might be uploaded.
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$aab = "$Mirror\android\app\build\outputs\bundle\release\app-release.aab"
$dest = Join-Path $Out ("shathisheba-{0}-vc{1}.aab" -f $version, $code)
Copy-Item $aab $dest -Force
Write-Host ""
Write-Host "Bundle ready: $dest" -ForegroundColor Green
Write-Host "Upload it in Play Console > Test and release > (track) > Create new release."
