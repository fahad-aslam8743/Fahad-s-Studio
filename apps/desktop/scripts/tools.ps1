$ErrorActionPreference='Stop'
try {
  $request=[Console]::In.ReadToEnd() | ConvertFrom-Json
  $name=[string]$request.name
  $a=$request.args
  function Out($x){$x | ConvertTo-Json -Depth 8 -Compress;exit 0}
  function AppList {
    $apps=@(Get-StartApps | Select-Object @{N='name';E={$_.Name}},@{N='id';E={$_.AppID}})
    $dirs=@("$env:APPDATA\Microsoft\Windows\Start Menu\Programs","$env:ProgramData\Microsoft\Windows\Start Menu\Programs")
    foreach($dir in $dirs){if(Test-Path -LiteralPath $dir){$apps+=@(Get-ChildItem -LiteralPath $dir -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {@{name=$_.BaseName;id=$_.FullName}})}}
    return @($apps|Sort-Object name -Unique)
  }
  function TargetProcess($argsInput) {
    if($argsInput.pid){return Get-Process -Id ([int]$argsInput.pid) -ErrorAction Stop}
    if(-not $argsInput.name){throw 'Provide app name or PID'}
    $search=[string]$argsInput.name
    $found=@(Get-Process | Where-Object {$_.MainWindowHandle -ne 0 -and ($_.ProcessName -like ('*'+$search+'*') -or $_.MainWindowTitle -like ('*'+$search+'*'))})
    if($found.Count -eq 0){throw 'No matching running window'}
    if($found.Count -gt 1){Out @{status='ambiguous';choices=@($found|Select-Object ProcessName,Id,MainWindowTitle)}}
    return $found[0]
  }
  function EditDistance([string]$left,[string]$right) {
    $previous=@(0..$right.Length)
    for($i=1;$i -le $left.Length;$i++){
      $current=New-Object int[] ($right.Length+1)
      $current[0]=$i
      for($j=1;$j -le $right.Length;$j++){
        $cost=if($left[$i-1] -eq $right[$j-1]){0}else{1}
        $current[$j]=[Math]::Min([Math]::Min($current[$j-1]+1,$previous[$j]+1),$previous[$j-1]+$cost)
      }
      $previous=$current
    }
    return $previous[$right.Length]
  }
  function WinApi {
   if(-not ('NativeWindows' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class NativeWindows {
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int cmd);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h,int x,int y,int w,int hgt,bool repaint);
 [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hwnd,uint flags);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,int flags,UIntPtr info);
 [StructLayout(LayoutKind.Sequential)] public struct RECT {public int left,top,right,bottom;}
}
'@
   }
  }
  switch($name){
   'list_installed_apps' {Out @{apps=@(AppList)}}
   'open_app' {
    $apps=@(AppList);$q=([string]$a.name).ToLowerInvariant()
    $ranked=@($apps|ForEach-Object {$label=[string]$_.name;$lower=$label.ToLowerInvariant();$score=if($lower -eq $q){0}elseif($lower.StartsWith($q)){1}elseif($lower.Contains($q)){2}else{$distance=EditDistance $lower $q;if($distance -le [Math]::Max(2,[Math]::Ceiling($q.Length*.25))){3+$distance}else{100}};if($score -lt 100){@{name=$label;id=$_.id;score=$score}}}|Sort-Object score,name)
    if($a.selection){$chosen=$ranked|Where-Object {$_.id -eq $a.selection}|Select-Object -First 1}
    elseif($ranked.Count -eq 1 -or ($ranked.Count -gt 1 -and $ranked[0].score -eq 0 -and $ranked[1].score -ne 0)){$chosen=$ranked[0]}
    elseif($ranked.Count -gt 0){Out @{status='ambiguous';choices=@($ranked|Select-Object -First 8)}}
    else {Out @{status='not_found';query=$a.name}}
    $id=[string]$chosen.id
    if($id.EndsWith('.lnk')){Start-Process -FilePath $id}
    else {Start-Process -FilePath 'explorer.exe' -ArgumentList @("shell:AppsFolder\$id")}
    Out @{status='opened';app=$chosen.name}
   }
   'list_running_apps' {Out @{apps=@(Get-Process|Where-Object {$_.MainWindowHandle -ne 0}|Select-Object ProcessName,Id,MainWindowTitle)}}
   'close_app' {$p=TargetProcess $a;Out @{requested=$p.CloseMainWindow();pid=$p.Id}}
   'window_control' {
     if($a.action -eq 'minimize_all'){$shell=New-Object -ComObject Shell.Application;$shell.MinimizeAll();Out @{ok=$true}}
     $p=TargetProcess $a;if($p.MainWindowHandle -eq 0){throw 'No visible top-level window for process'}
     Add-Type -AssemblyName System.Windows.Forms;WinApi;$hwnd=$p.MainWindowHandle
     switch($a.action){
      'minimize' {$ok=[NativeWindows]::ShowWindow($hwnd,6)}
      'maximize' {$ok=[NativeWindows]::ShowWindow($hwnd,3)}
      'restore' {$ok=[NativeWindows]::ShowWindow($hwnd,9)}
      'close' {$ok=$p.CloseMainWindow()}
      'focus' {$ok=[NativeWindows]::SetForegroundWindow($hwnd)}
      {$_ -in 'left','right'} {
        $rect=[NativeWindows+RECT]::new();[NativeWindows]::GetWindowRect($hwnd,[ref]$rect)|Out-Null
        $screen=[System.Windows.Forms.Screen]::FromHandle($hwnd).WorkingArea
        $w=[int]($screen.Width/2);$x=if($a.action -eq 'right'){$screen.Left+$w}else{$screen.Left}
        $ok=[NativeWindows]::MoveWindow($hwnd,$x,$screen.Top,$w,$screen.Height,$true)
      }
      'monitor_next' {
        $screens=[System.Windows.Forms.Screen]::AllScreens
        if($screens.Count -lt 2){throw 'Only one monitor detected'}
        $current=[System.Windows.Forms.Screen]::FromHandle($hwnd)
        $index=[Array]::FindIndex($screens,[Predicate[System.Windows.Forms.Screen]]{param($screen) $screen.DeviceName -eq $current.DeviceName})
        if($index -lt 0){throw 'Current monitor not found'}
        $next=$screens[($index+1)%$screens.Count].WorkingArea
        $rect=[NativeWindows+RECT]::new();[NativeWindows]::GetWindowRect($hwnd,[ref]$rect)|Out-Null
        [NativeWindows]::ShowWindow($hwnd,9)|Out-Null
        $width=[Math]::Min(($rect.right-$rect.left),$next.Width)
        $height=[Math]::Min(($rect.bottom-$rect.top),$next.Height)
        $ok=[NativeWindows]::MoveWindow($hwnd,$next.Left,$next.Top,$width,$height,$true)
      }
     }
     Out @{ok=[bool]$ok;action=$a.action}
   }
   'open_website' {Start-Process -FilePath ([string]$a.url);Out @{opened=$a.url}}
   'youtube_search' {$u='https://www.youtube.com/results?search_query='+[uri]::EscapeDataString([string]$a.query);Start-Process $u;Out @{opened=$u;note='First-result autoplay requires YouTube API and is not available in this mode'}}
   'system_volume' {
      WinApi
      $key=if($a.action -eq 'up'){175}elseif($a.action -eq 'down'){174}else{173}
      [NativeWindows]::keybd_event([byte]$key,0,0,[UIntPtr]::Zero)
      Start-Sleep -Milliseconds 35
      [NativeWindows]::keybd_event([byte]$key,0,2,[UIntPtr]::Zero)
      Out @{requested=$a.action;note='Virtual media keys; hardware and audio service may vary'}
   }
   'screen_brightness' {$m=Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop|Select-Object -First 1;if(-not $m){throw 'Brightness control not supported'};$m|Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=[byte]$a.percent}|Out-Null;Out @{brightness=$a.percent}}
   'system_radio' {
     if($a.device -ne 'wifi'){
       $uri=if($a.device -eq 'bluetooth'){'ms-settings:bluetooth'}else{'ms-settings:network-airplanemode'}
       Start-Process -FilePath $uri
       Out @{status='manual_action_required';device=$a.device;requestedEnabled=$a.enabled;settingsOpened=$uri;note='Reliable automated radio control unavailable without device-specific WinRT permissions'}
     }
     $identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()
     $principal=New-Object System.Security.Principal.WindowsPrincipal($identity)
     if(-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)){
       throw 'Wi-Fi adapter changes require Administrator rights. Jarvis will not elevate itself.'
     }
     $adapt=Get-NetAdapter -Physical|Where-Object {$_.InterfaceDescription -match 'Wi-Fi|Wireless|802.11'}|Select-Object -First 1;if(-not $adapt){throw 'Wi-Fi adapter not found'}
     if($a.enabled){Enable-NetAdapter -Name $adapt.Name -Confirm:$false -ErrorAction Stop}else{Disable-NetAdapter -Name $adapt.Name -Confirm:$false -ErrorAction Stop};Out @{ok=$true;requiresAdmin=$true}
   }
   'dark_mode' {$reg='HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize';Set-ItemProperty -Path $reg -Name AppsUseLightTheme -Value ([int](!$a.enabled));Set-ItemProperty -Path $reg -Name SystemUsesLightTheme -Value ([int](!$a.enabled));Out @{ok=$true;note='Some apps require restart'}}
   'lock_screen' {Start-Process -FilePath 'rundll32.exe' -ArgumentList @('user32.dll,LockWorkStation');Out @{requested=$true}}
   'sleep_pc' {Start-Process -FilePath 'rundll32.exe' -ArgumentList @('powrprof.dll,SetSuspendState','0,1,0');Out @{requested=$true;note='Hibernate and system policies may alter behavior'}}
   'open_folder' {if(-not (Test-Path -LiteralPath ([string]$a.path) -PathType Container)){throw 'Folder not found'};Start-Process -FilePath 'explorer.exe' -ArgumentList @([string]$a.path);Out @{opened=$a.path}}
   'find_file' {$root=if($a.root){[string]$a.root}else{[Environment]::GetFolderPath('MyDocuments')};if(-not(Test-Path -LiteralPath $root -PathType Container)){throw 'Search root missing'};$items=@(Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue|Where-Object {$_.Name -like ('*'+[string]$a.name+'*')}|Select-Object -First 30 -ExpandProperty FullName);Out @{files=$items;truncated=($items.Count -ge 30)}}
   'open_file' {if(-not(Test-Path -LiteralPath ([string]$a.path) -PathType Leaf)){throw 'File not found'};Start-Process -FilePath ([string]$a.path);Out @{opened=$a.path}}
   'move_file' {if(-not(Test-Path -LiteralPath ([string]$a.source) -PathType Leaf)){throw 'Source missing'};Move-Item -LiteralPath ([string]$a.source) -Destination ([string]$a.destination) -ErrorAction Stop;Out @{moved=$true}}
   'delete_file' {Add-Type -AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile([string]$a.path,'OnlyErrorDialogs','SendToRecycleBin');Out @{recycled=$true}}
   'clipboard_read' {Add-Type -AssemblyName System.Windows.Forms;Out @{text=[System.Windows.Forms.Clipboard]::GetText()}}
   'clipboard_write' {Set-Clipboard -Value ([string]$a.text);Out @{written=$true}}
   'screenshot' {Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing;$rect=[System.Windows.Forms.SystemInformation]::VirtualScreen;$bmp=New-Object System.Drawing.Bitmap($rect.Width,$rect.Height);$g=[System.Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen($rect.Left,$rect.Top,0,0,$bmp.Size);$file=Join-Path ([Environment]::GetFolderPath('MyPictures')) ('Jarvis-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.png');$bmp.Save($file);$g.Dispose();$bmp.Dispose();Out @{path=$file}}
   default {throw 'Unknown or blocked tool'}
  }
}catch{ @{error=$_.Exception.Message}|ConvertTo-Json -Compress;exit 1}
