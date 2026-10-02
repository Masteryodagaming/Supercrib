# Run on MSI (firebase logged in), from supercrib repo root:
#   powershell -File scripts\dummy-unlock\msi-patch-dummy.ps1
$ErrorActionPreference = 'Stop'
$uid = 'cHYLDPXD6cSdZCtNmxv7hmg0VSI2'
$project = 'supercrib241-baba2'
$path = "/users/$uid/profile"
$updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$payload = @{
  ownedBoardIds = @('default','zero_forge')
  ownedFeltIds  = @('felt','zero_forge','cj_dumpster')
  settings      = @{ board = 'default' }
  updatedAt     = $updatedAt
} | ConvertTo-Json -Compress
$tmp = Join-Path $env:TEMP 'dummy-unlock-patch.json'
Set-Content -Path $tmp -Value $payload -Encoding UTF8
Write-Host "GET before:"
npx.cmd firebase database:get "$path/ownedBoardIds" --project $project
npx.cmd firebase database:get "$path/ownedFeltIds" --project $project
Write-Host "PATCH $tmp"
npx.cmd firebase database:update $path --project $project -d "@$tmp"
Write-Host "GET after:"
npx.cmd firebase database:get "$path/ownedBoardIds" --project $project
npx.cmd firebase database:get "$path/ownedFeltIds" --project $project
npx.cmd firebase database:get "$path/updatedAt" --project $project
