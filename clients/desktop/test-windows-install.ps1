$ErrorActionPreference = 'Stop'
$repo = Join-Path $PSScriptRoot '../..'
$version = (Get-Content (Join-Path $PSScriptRoot 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $repo "dist/FirstMove-$version-windows-x64-Setup.exe"
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Yraguo.FirstMove'
$default = Join-Path $env:LOCALAPPDATA 'Programs\Yraguo\FirstMove'
$iconSource = Join-Path $repo 'dist/win-release/.icon-ico/icon.ico'

function Install-FirstMove([string]$Arguments) {
    (Start-Process -FilePath $installer -ArgumentList $Arguments -PassThru -Wait).ExitCode
}

function Assert-FirstMoveInstallation([string]$Directory) {
    $exe = Join-Path $Directory 'app\先行.exe'
    $icon = Join-Path $Directory 'app\FirstMove.ico'
    if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Missing executable at $exe" }
    if ((Get-FileHash -LiteralPath $icon).Hash -ne (Get-FileHash -LiteralPath $iconSource).Hash) {
        throw "Unexpected installed icon at $icon"
    }
    $app = Get-ItemProperty -LiteralPath $registry
    if ($app.InstallLocation -ne $Directory -or $app.DisplayIcon -ne "$icon,0" -or $app.DisplayVersion -ne $version) {
        throw "Incorrect uninstall registration for $Directory"
    }
    $shell = New-Object -ComObject WScript.Shell
    foreach ($folder in @('Programs', 'DesktopDirectory')) {
        $link = Join-Path ([Environment]::GetFolderPath($folder)) '先行.lnk'
        if (!(Test-Path -LiteralPath $link -PathType Leaf)) { throw "Missing shortcut $link" }
        $shortcut = $shell.CreateShortcut($link)
        if ($shortcut.TargetPath -ne $exe -or $shortcut.IconLocation -ne "$icon,0") {
            throw "Incorrect shortcut target or icon at $link"
        }
    }
    Write-Host "Verified installation and icons at $Directory"
}

if (Test-Path -LiteralPath $registry) { throw 'Run on a clean Windows test account.' }
if ((Install-FirstMove '/S') -ne 0) { throw 'Default installation failed.' }
Assert-FirstMoveInstallation $default

$otherRoot = New-Item -Type Directory -Path (Join-Path $env:RUNNER_TEMP 'firstmove-other-drive')
$drive = 90..68 | ForEach-Object { "$([char]$_):" } | Where-Object { !(Test-Path "$_\") } | Select-Object -First 1
if (!$drive) { throw 'No free drive letter for the test.' }
& subst.exe $drive $otherRoot.FullName
if ($LASTEXITCODE -ne 0) { throw 'Could not create the temporary test drive.' }
try {
    $custom = Join-Path "$drive\" '应用 Folder\FirstMove'
    if ((Install-FirstMove "/S /D=$custom") -ne 0) { throw 'Installation on the alternate drive failed.' }
    Assert-FirstMoveInstallation $custom
    if (!(Test-Path -LiteralPath (Join-Path $default 'app\先行.exe'))) { throw 'The old install was removed.' }

    $blocked = New-Item -Type Directory -Path (Join-Path "$drive\" 'blocked')
    New-Item -Type File -Path (Join-Path $blocked.FullName 'app') | Out-Null
    if ((Install-FirstMove "/S /D=$($blocked.FullName)") -eq 0) { throw 'Installer accepted an invalid app directory.' }
    Assert-FirstMoveInstallation $custom
} finally {
    & subst.exe $drive /d
}
