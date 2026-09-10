#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Distribution = 'Ubuntu-24.04',
    [switch]$InstallSystemDeps,
    [switch]$ReplaceLegacy,
    [string]$ConfigPath = (Join-Path $env:USERPROFILE '.lmstudio\mcp.json'),
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Full Fecimus runs in WSL2. This launcher never injects host mouse or keyboard input.
if ($env:OS -ne 'Windows_NT') { throw 'Run this launcher in Windows 11 Pro PowerShell.' }
$fecimusWindows = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
if ([int]$fecimusWindows.CurrentBuildNumber -lt 22000 -or $fecimusWindows.EditionID -notin @('Professional', 'ProfessionalN')) {
    throw 'Fecimus supports Windows 11 Pro and Pro N (build 22000+) only. Home, Enterprise, Education, and Pro for Workstations are outside this release support policy.'
}
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw 'WSL is missing. In an Administrator terminal run: wsl --install -d Ubuntu-24.04 . Restart Windows if requested, open Ubuntu, create your Linux user, and rerun this script.'
}
$fecimusDistributions = @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty $_.PSPath })
$fecimusDistro = @($fecimusDistributions | Where-Object { $_.DistributionName -eq $Distribution })
if ($fecimusDistro.Count -ne 1) {
    throw "Distribution '$Distribution' is not initialized for this Windows user. Run wsl --list --verbose. Install with wsl --install -d Ubuntu-24.04, open Ubuntu and create your Linux user, then rerun with -Distribution <installed-name>."
}
if ([int]$fecimusDistro[0].Version -ne 2) {
    throw "'$Distribution' uses WSL 1. Run wsl --set-version `"$Distribution`" 2, then retry."
}

function Invoke-FecimusWslCapture {
    param([string[]]$Arguments)
    $fecimusOutput = & wsl.exe --distribution $Distribution --exec @Arguments
    if ($LASTEXITCODE -ne 0) { throw "WSL command failed (exit $LASTEXITCODE): $($Arguments[0])" }
    return (($fecimusOutput -join "`n") -replace "`0", '').Trim()
}

$fecimusLinuxUser = Invoke-FecimusWslCapture -Arguments @('/usr/bin/id', '-u')
if ($fecimusLinuxUser -eq '0') { throw 'Your WSL default user is root. Configure an ordinary default Linux user before installing Fecimus.' }
$fecimusLinuxHome = Invoke-FecimusWslCapture -Arguments @('/usr/bin/printenv', 'HOME')
if (-not $fecimusLinuxHome.StartsWith('/')) { throw 'WSL did not return an absolute Linux home directory.' }
$fecimusRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $fecimusRoot 'package-lock.json'))) { throw 'Run install.ps1 from the complete Fecimus checkout or release archive, including package-lock.json.' }
$fecimusLinuxSource = Invoke-FecimusWslCapture -Arguments @('/usr/bin/wslpath', '-u', $fecimusRoot)
$fecimusWindowsProfile = Invoke-FecimusWslCapture -Arguments @('/usr/bin/wslpath', '-u', $env:USERPROFILE)

if ($CheckOnly) {
    & wsl.exe --distribution $Distribution --exec bash "$fecimusLinuxSource/scripts/install.sh" --check
    if ($LASTEXITCODE -ne 0) { throw 'Linux dependency check failed. Rerun without -CheckOnly and include -InstallSystemDeps.' }
    Write-Host 'Windows 11 Pro / WSL2 checks passed. No LM Studio configuration changed.'
    return
}

# A fresh source directory makes an upgrade reversible: old config backups still
# point to the old working source. No existing checkout or user data is deleted.
$fecimusStamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$fecimusLinuxTarget = "$fecimusLinuxHome/.local/share/fecimus/sources/$fecimusStamp"
$fecimusInstallArgs = @('--distribution', $Distribution, '--exec', 'bash', "$fecimusLinuxSource/scripts/install.sh", '--copy-to', $fecimusLinuxTarget, '--skip-config')
if ($InstallSystemDeps) { $fecimusInstallArgs += '--system-deps' }
& wsl.exe @fecimusInstallArgs
if ($LASTEXITCODE -ne 0) { throw "Fecimus setup failed in WSL. Windows configuration is unchanged. The staged source is $fecimusLinuxTarget ." }
$fecimusLinuxEntry = (Invoke-FecimusWslCapture -Arguments @('bash', "$fecimusLinuxTarget/scripts/install.sh", '--print-entry')) | ConvertFrom-Json

# Supply the Linux environment as arguments to Linux env, never as Windows PATH.
$fecimusLaunchArgs = @('--distribution', $Distribution, '--exec', '/usr/bin/env')
foreach ($fecimusProperty in $fecimusLinuxEntry.env.PSObject.Properties) { $fecimusLaunchArgs += "$($fecimusProperty.Name)=$($fecimusProperty.Value)" }
$fecimusFileRoots = ConvertTo-Json -InputObject @($fecimusLinuxHome, $fecimusWindowsProfile) -Compress
$fecimusLaunchArgs += "FECIMUS_FILE_ROOTS=$fecimusFileRoots"
$fecimusLaunchArgs += [string]$fecimusLinuxEntry.command
$fecimusLaunchArgs += @($fecimusLinuxEntry.args)
$fecimusEntry = [ordered]@{ command = 'wsl.exe'; args = $fecimusLaunchArgs }
$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
$fecimusOriginal = $null
if (Test-Path -LiteralPath $ConfigPath) {
    $fecimusOriginal = [System.IO.File]::ReadAllText($ConfigPath)
    $fecimusConfig = $fecimusOriginal | ConvertFrom-Json
    if ($null -eq $fecimusConfig -or $fecimusConfig -isnot [System.Management.Automation.PSCustomObject]) { throw 'Existing MCP configuration must be a JSON object.' }
} else { $fecimusConfig = [pscustomobject]@{} }
if (-not $fecimusConfig.PSObject.Properties['mcpServers']) {
    $fecimusConfig | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{})
}
if ($null -eq $fecimusConfig.mcpServers -or $fecimusConfig.mcpServers -isnot [System.Management.Automation.PSCustomObject]) { throw 'Existing mcpServers must be a JSON object.' }
if ($ReplaceLegacy) {
    foreach ($fecimusLegacy in @('playwright', 'desktop-mouse', 'desktop-vision', 'desktop-keyboard', 'desktop-apps', 'terminal-files')) {
        $fecimusConfig.mcpServers.PSObject.Properties.Remove($fecimusLegacy)
    }
}
$fecimusConfig.mcpServers | Add-Member -NotePropertyName fecimus -NotePropertyValue $fecimusEntry -Force
$fecimusDirectory = Split-Path -Parent $ConfigPath
[System.IO.Directory]::CreateDirectory($fecimusDirectory) | Out-Null
$fecimusTemporary = "$ConfigPath.tmp-$fecimusStamp"
$fecimusBackup = "$ConfigPath.backup-$fecimusStamp"
$fecimusUtf8 = New-Object System.Text.UTF8Encoding($false)
try {
    $fecimusCurrent = if (Test-Path -LiteralPath $ConfigPath) { [System.IO.File]::ReadAllText($ConfigPath) } else { $null }
    if ($fecimusCurrent -cne $fecimusOriginal) { throw 'MCP configuration changed during installation. Retry after saving your editor.' }
    [System.IO.File]::WriteAllText($fecimusTemporary, (($fecimusConfig | ConvertTo-Json -Depth 100) + "`n"), $fecimusUtf8)
    if ($null -ne $fecimusOriginal) {
        [System.IO.File]::Replace($fecimusTemporary, $ConfigPath, $fecimusBackup)
        Write-Host "Previous configuration: $fecimusBackup"
    } else { [System.IO.File]::Move($fecimusTemporary, $ConfigPath) }
} finally {
    if (Test-Path -LiteralPath $fecimusTemporary) { Remove-Item -LiteralPath $fecimusTemporary }
}
Write-Host "Fecimus registered in $ConfigPath . Restart LM Studio, select a tool-capable model, and enable mcp/fecimus."
Write-Host "Its independent desktop and headless browser run in WSL2 ($Distribution). Your Windows pointer is unaffected."
