#Requires -Version 5.1
[CmdletBinding()]
param([string]$Worker = '', [string]$ResultPath = '', [string]$Distribution = 'Ubuntu-24.04', [string]$AddonPath = '')
$ErrorActionPreference = 'Stop'
$fecimusRoot = Split-Path -Parent $PSScriptRoot

function Invoke-FecimusAddon {
    param([string]$Action, [string]$Folder)
    if ($Action -notin @('list', 'inspect', 'install')) { throw 'Unsupported addon action.' }
    $entry = (Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.lmstudio\mcp.json') -Raw | ConvertFrom-Json).mcpServers.fecimus
    if ($entry.command -ne 'wsl.exe') { throw 'Install Fecimus for Windows first. Expected the WSL2 Fecimus entry in LM Studio configuration.' }
    $launch = @($entry.args)
    if ($launch.Count -lt 5 -or $launch[-1] -notmatch '/src/server\.mjs$') { throw 'Unrecognized Fecimus launch configuration. Use the documented addon CLI for custom configurations.' }
    $distroIndex = [Array]::IndexOf($launch, '--distribution')
    if ($distroIndex -lt 0 -or $distroIndex + 1 -ge $launch.Count) { throw 'Missing WSL distribution in Fecimus configuration.' }
    $launch[-1] = $launch[-1] -replace '/src/server\.mjs$', '/scripts/addons.mjs'
    $launch += $Action
    if ($Action -ne 'list') {
        $linuxFolder = & wsl.exe --distribution $launch[$distroIndex + 1] --exec /usr/bin/wslpath -u $Folder
        if ($LASTEXITCODE -ne 0) { throw 'Cannot map the selected folder into WSL.' }
        $launch += (($linuxFolder -join "`n") -replace "`0", '').Trim()
    }
    if ($Action -eq 'install') { $launch += '--trust' }
    & wsl.exe @launch
    if ($LASTEXITCODE -ne 0) { throw "Addon action failed (exit $LASTEXITCODE)." }
}

if ($Worker) {
    $code = 1
    try {
        if ($Worker -eq 'install') { & (Join-Path $PSScriptRoot 'install.ps1') -Distribution $Distribution -InstallSystemDeps -ReplaceLegacy }
        elseif ($Worker -eq 'addon') { Invoke-FecimusAddon -Action install -Folder $AddonPath }
        else { throw 'Unknown setup worker.' }
        $code = 0
    } catch { Write-Host $_ -ForegroundColor Red }
    finally {
        @{ exit_code = $code } | ConvertTo-Json | Set-Content -LiteralPath $ResultPath -Encoding UTF8
    }
    if ($code -ne 0) { Read-Host 'Read the error above. Press Enter to close' | Out-Null }
    exit $code
}

Add-Type -AssemblyName PresentationFramework, System.Windows.Forms
[xml]$markup = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="Fecimus / Setup and addons" Width="820" Height="700" MinWidth="720" MinHeight="620" WindowStartupLocation="CenterScreen" Background="#101820" Foreground="#E7F2F3">
<Window.Resources><Style TargetType="Button"><Setter Property="Background" Value="#243742"/><Setter Property="Foreground" Value="White"/><Setter Property="Padding" Value="16,12"/><Setter Property="Margin" Value="0,0,12,0"/><Setter Property="BorderThickness" Value="0"/></Style></Window.Resources>
<Grid Margin="30"><Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
<TextBlock Text="FECIMUS / 3.0" Foreground="#96B9C0"/>
<TextBlock Grid.Row="1" Text="Your workspace. Extended." FontSize="36" FontWeight="Bold" Margin="0,14,0,12"/>
<TextBlock Grid.Row="2" Text="One MCP connection. A private Linux desktop, background browser and project tools. Windows 11 Pro / Pro N with initialized Ubuntu LTS in WSL2 required." TextWrapping="Wrap" Margin="0,0,0,20"/>
<StackPanel Grid.Row="3" Orientation="Horizontal" Margin="0,0,0,20"><TextBlock Text="WSL distribution" VerticalAlignment="Center" Margin="0,0,16,0"/><TextBox Name="Distro" Text="Ubuntu-24.04" Width="260" Padding="8"/></StackPanel>
<WrapPanel Grid.Row="4"><Button Name="Install" Content="Install / upgrade Fecimus" Background="#117D70"/><Button Name="Addon" Content="Install addon..."/><Button Name="List" Content="My addons"/></WrapPanel>
<TextBlock Grid.Row="5" Name="Status" Text="Ready / Internet access is required for setup" Foreground="#96B9C0" TextWrapping="Wrap" Margin="0,20,0,12"/>
<TextBox Grid.Row="6" Name="Details" IsReadOnly="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" Background="#17252F" Foreground="#D5E8EC" BorderThickness="0" Padding="12" Text="First installation: run wsl --install -d Ubuntu-24.04 in an administrator terminal, restart if requested, then open Ubuntu and create your ordinary Linux user. The install button backs up LM Studio configuration and replaces six legacy Fecimus connections. A console handles sudo prompts. Native Windows studio windows are not controlled by Fecimus's Linux cursor."/>
<TextBlock Grid.Row="7" Text="Models and studio applications are installed separately. Addons run with your account permissions. Restart Fecimus after installing an addon." TextWrapping="Wrap" Foreground="#96B9C0" Margin="0,18,0,0"/>
</Grid></Window>
'@
$window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $markup))
$install = $window.FindName('Install'); $addon = $window.FindName('Addon'); $list = $window.FindName('List')
$status = $window.FindName('Status'); $details = $window.FindName('Details'); $distro = $window.FindName('Distro')
$script:fecimusOperation = $null
function Start-FecimusOperation {
    param([string]$Kind, [string]$Folder = '')
    $result = Join-Path ([IO.Path]::GetTempPath()) ('fecimus-setup-' + [Guid]::NewGuid().ToString('N') + '.json')
    # Encode the fixed script invocation to preserve spaces/quotes in user paths.
    $quote = { param($value) "'" + $value.Replace("'", "''") + "'" }
    $command = '& ' + (& $quote (Join-Path $PSScriptRoot 'setup-gui.ps1')) + ' -Worker ' + (& $quote $Kind) + ' -ResultPath ' + (& $quote $result) + ' -Distribution ' + (& $quote $distro.Text) + ' -AddonPath ' + (& $quote $Folder)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    $process = Start-Process powershell.exe -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -PassThru
    $script:fecimusOperation = @{ process = $process; result = $result; kind = $Kind }
    $install.IsEnabled = $false; $addon.IsEnabled = $false; $list.IsEnabled = $false
    $status.Text = 'Working / follow the console for progress and password prompts'
}
$install.Add_Click({ try { Start-FecimusOperation -Kind install } catch { $status.Text = 'Could not start setup'; $details.Text = $_.ToString() } })
$addon.Add_Click({
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Choose the extracted folder containing fecimus-addon.json'
    try {
        if ($picker.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return }
        $folder = $picker.SelectedPath
        $inspection = (Invoke-FecimusAddon -Action inspect -Folder $folder | Out-String)
        $details.Text = $inspection
        $answer = [Windows.MessageBox]::Show($window, ($inspection + "`nThis addon can execute code with your account permissions on restart. Install only source you trust. Nothing is uploaded to GitHub."), 'Install trusted addon?', 'OKCancel', 'Warning')
        if ($answer -eq 'OK') { Start-FecimusOperation -Kind addon -Folder $folder }
    } catch { $status.Text = 'Addon inspection failed'; $details.Text = $_.ToString() }
    finally { $picker.Dispose() }
})
$list.Add_Click({ try { $details.Text = (Invoke-FecimusAddon -Action list | Out-String); $status.Text = 'Installed addons' } catch { $details.Text = $_.ToString(); $status.Text = 'Cannot list addons' } })
$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({
    if ($null -eq $script:fecimusOperation) { return }
    $op = $script:fecimusOperation
    if (Test-Path -LiteralPath $op.result) {
        try {
            $result = Get-Content -LiteralPath $op.result -Raw | ConvertFrom-Json
            $status.Text = if ($result.exit_code -eq 0) { 'Completed / restart LM Studio and enable mcp/fecimus' } else { 'Failed / read the error in the console' }
            Remove-Item -LiteralPath $op.result
        } catch { return } # A write can still be in progress; retry the next tick.
    } elseif ($op.process.HasExited) { $status.Text = 'Setup closed before completion / check prerequisites and retry' }
    else { return }
    $script:fecimusOperation = $null
    $install.IsEnabled = $true; $addon.IsEnabled = $true; $list.IsEnabled = $true
})
$window.Add_Closing({ param($sender, $eventArgs) if ($null -ne $script:fecimusOperation) { $eventArgs.Cancel = $true; $status.Text = 'Wait for the running action or close its console before exiting setup' } })
$timer.Start()
try { $window.ShowDialog() | Out-Null } finally { $timer.Stop() }
