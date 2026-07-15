param(
  [string]$ReleaseDir = (Join-Path $PSScriptRoot "..\release"),
  [switch]$RequireSignature
)

$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJson = [IO.File]::ReadAllText(
  (Join-Path $projectRoot "package.json"),
  [Text.UTF8Encoding]::new($false)
)
$package = $packageJson | ConvertFrom-Json
$version = [string]$package.version
$releasePath = [IO.Path]::GetFullPath($ReleaseDir)
$portablePath = Join-Path $releasePath "image-style-prompt-extractor-win-portable-$version-x64.zip"
$installerPath = Join-Path $releasePath "image-style-prompt-extractor-win-setup-$version-x64.exe"

foreach ($asset in @($portablePath, $installerPath)) {
  if (-not (Test-Path -LiteralPath $asset -PathType Leaf)) {
    throw "Missing Windows release asset: $asset"
  }
}

$extractPath = Join-Path ([IO.Path]::GetTempPath()) ("image-style-windows-verify-" + [guid]::NewGuid())
try {
  Expand-Archive -LiteralPath $portablePath -DestinationPath $extractPath
  $appExe = Get-ChildItem -LiteralPath $extractPath -Filter "image-style-prompt-extractor.exe" -File -Recurse |
    Select-Object -First 1
  if (-not $appExe) { throw "Portable ZIP does not contain image-style-prompt-extractor.exe" }
  if (-not (Test-Path -LiteralPath (Join-Path $appExe.DirectoryName "resources\app.asar"))) {
    throw "Portable ZIP does not contain resources\app.asar next to the executable"
  }

  $bytes = [IO.File]::ReadAllBytes($appExe.FullName)
  if ($bytes.Length -lt 256) { throw "Application executable is too small to be a valid PE file" }
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
  $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
  if ($machine -ne 0x8664) { throw ("Expected x64 PE machine 0x8664, found 0x{0:X4}" -f $machine) }

  $productVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($appExe.FullName).ProductVersion
  if (-not $productVersion.StartsWith($version, [StringComparison]::Ordinal)) {
    throw "Expected application version $version, found $productVersion"
  }

  $signatureResults = @(
    [pscustomobject]@{ Asset = $appExe.FullName; Signature = Get-AuthenticodeSignature -LiteralPath $appExe.FullName },
    [pscustomobject]@{ Asset = $installerPath; Signature = Get-AuthenticodeSignature -LiteralPath $installerPath }
  )
  foreach ($result in $signatureResults) {
    $subject = if ($result.Signature.SignerCertificate) { $result.Signature.SignerCertificate.Subject } else { "<none>" }
    Write-Host "Authenticode $($result.Signature.Status): $($result.Asset) [$subject]"
    if ($RequireSignature -and $result.Signature.Status -ne "Valid") {
      throw "A trusted Windows signature is required but $($result.Asset) is $($result.Signature.Status)"
    }
  }

  $assets = @($portablePath, $installerPath)
  $checksumLines = foreach ($asset in $assets) {
    $hash = (Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash *$([IO.Path]::GetFileName($asset))"
  }
  $checksumPath = Join-Path $releasePath "SHA256SUMS.txt"
  Set-Content -LiteralPath $checksumPath -Value $checksumLines -Encoding ascii
  Write-Host "Windows artifacts verified. SHA-256 manifest: $checksumPath"
} finally {
  Remove-Item -LiteralPath $extractPath -Recurse -Force -ErrorAction SilentlyContinue
}
