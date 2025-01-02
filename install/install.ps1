param (
    [string]$installPath = "~\Clockwork"
)

# Define the installation directory
$installDir = $installPath
Write-Debug "Installation directory: $installDir"

# Check administrator privileges
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    # Elevate the script
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-File $PSCommandPath -installPath $installPath"
    exit
}

try {
    # Create the installation directory if it doesn't exist
    if (-Not (Test-Path -Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir
    }

    # Set permissions for the installation directory
    icacls $installDir /grant "Everyone:(OI)(CI)F" /T

    # Download the latest release
    $latestReleaseUrl = "https://github.com/Turtlepaw/clockwork/releases/latest/download/clockwork-win.exe"
    $destinationPath = Join-Path -Path $installDir -ChildPath "clockwork.exe"
    Invoke-WebRequest -Uri $latestReleaseUrl -OutFile $destinationPath

    # Add the installation directory to the PATH environment variable
    [System.Environment]::SetEnvironmentVariable("Path", $env:Path + ";$installDir", [System.EnvironmentVariableTarget]::Machine)
    # Set CLOCKWORK_HOME
    [System.Environment]::SetEnvironmentVariable("CLOCKWORK_HOME", $installDir, [System.EnvironmentVariableTarget]::Machine)

    Write-Output "Clockwork has been installed successfully."
    Write-Output "Restart your terminal to start using Clockwork."
} catch {
    Write-Error "An error occurred: $_"
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# Press any key to exit
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")