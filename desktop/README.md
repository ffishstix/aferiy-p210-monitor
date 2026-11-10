# Battery Watch for Windows

This is the tray application for [battery.fishstix.uk](https://battery.fishstix.uk). Left-click its icon to open a bottom-right dock showing P210 charge, input and output power, runtime estimate, and update time. The icon changes colour for charging, passing power through, discharging, low charge, stale readings, and faults. Windows notifications appear when the P210 starts discharging and below 15%, with follow-ups at 10% and 5%. It does not shut down the PC.

The app reads the public read-only status endpoint every 30 seconds. If that endpoint becomes private, it asks for the dashboard password and protects it with Windows DPAPI for the current user. It has a “Start with Windows” switch in the dock. The dashboard URL is `https://battery.fishstix.uk`.

Direct downloads for x64, ARM64, and x86 Windows are on [the download page](https://battery.fishstix.uk/download.html). They are framework-dependent single-file executables and require the matching [Microsoft .NET 10 Desktop Runtime](https://dotnet.microsoft.com/en-us/download/dotnet/10.0) if it is not already installed. They are currently unsigned; SHA-256 checksums appear beside the downloads.

To rebuild with the .NET 10 SDK, run `./build.ps1` from PowerShell. The binaries are published into `cloud/public/downloads/`. On a Windows x64 development PC, run `BatteryWatch.exe --self-test` to check state classification and dock construction without opening the tray app. The ARM64 binary's PE architecture has been checked but needs a real ARM Windows test.
