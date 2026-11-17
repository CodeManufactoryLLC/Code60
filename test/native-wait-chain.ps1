# Temporary read-only native validation probe. Never emit names or addresses.
param([uint32]$RootPid)
$ErrorActionPreference = 'Stop'
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)
$owned = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$owned.Add($RootPid)
do {
  $added = $false
  foreach ($p in $all) {
    if ($owned.Contains([uint32]$p.ParentProcessId) -and $owned.Add([uint32]$p.ProcessId)) { $added = $true }
  }
} while ($added)
$tree = @($all | Where-Object { $owned.Contains([uint32]$_.ProcessId) } | ForEach-Object {
  $kind = switch ($_.Name) {
    'electron.exe' { 'electron' }
    'cmd.exe' { 'shell' }
    'node.exe' { 'node' }
    'code60-host.exe' { 'helper' }
    default { 'other' }
  }
  [pscustomobject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; kind = $kind }
})
# Publish the tree even if the optional wait-chain provider is unavailable.
ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ tree = $tree })
if (!@($tree | Where-Object { $_.kind -eq 'electron' }).Count) { exit 0 }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeWaitChain {
  // WAITCHAIN_NODE_INFO is 280 bytes on both x86 and x64. Omit the lock-name
  // union entirely; only fixed types/statuses and thread ownership are read.
  [StructLayout(LayoutKind.Explicit, Size = 280)]
  public struct Node {
    [FieldOffset(0)] public uint Type;
    [FieldOffset(4)] public uint Status;
    [FieldOffset(8)] public uint Process;
    [FieldOffset(12)] public uint Thread;
  }
  public sealed class Result {
    public bool Ok;
    public int Error;
    public bool Cycle;
    public Node[] Nodes;
  }
  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern IntPtr OpenThreadWaitChainSession(uint flags, IntPtr callback);
  [DllImport("advapi32.dll")]
  private static extern void CloseThreadWaitChainSession(IntPtr session);
  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern bool GetThreadWaitChain(IntPtr session, IntPtr context,
    uint flags, uint thread, ref uint count, [Out] Node[] nodes, out bool cycle);
  public static Result Read(uint thread) {
    var result = new Result { Nodes = new Node[0] };
    var session = OpenThreadWaitChainSession(0, IntPtr.Zero);
    if (session == IntPtr.Zero) { result.Error = Marshal.GetLastWin32Error(); return result; }
    try {
      uint count = 16;
      var nodes = new Node[count];
      bool cycle;
      // Do not follow outside processes or change privileges.
      result.Ok = GetThreadWaitChain(session, IntPtr.Zero, 0, thread, ref count, nodes, out cycle);
      result.Error = result.Ok ? 0 : Marshal.GetLastWin32Error();
      result.Cycle = cycle;
      if (result.Ok) {
        Array.Resize(ref nodes, (int)Math.Min(count, 16));
        result.Nodes = nodes;
      }
      return result;
    } finally { CloseThreadWaitChainSession(session); }
  }
}
'@
foreach ($p in @($tree | Where-Object { $_.kind -eq 'electron' })) {
  try {
    $process = Get-Process -Id $p.pid -ErrorAction Stop
    $threads = @($process.Threads | Sort-Object StartTime)
    $details = @($threads | Select-Object -First 128 | ForEach-Object {
      $thread = $_
      $state = $thread.ThreadState.ToString()
      $reason = if ($state -eq 'Wait') { $thread.WaitReason.ToString() } else { 'not-waiting' }
      $chain = [NativeWaitChain]::Read([uint32]$thread.Id)
      $nodes = @($chain.Nodes | ForEach-Object {
        # The union is thread identity only for WctThreadType (8).
        $isOwned = $_.Type -eq 8 -and $owned.Contains($_.Process)
        [pscustomobject]@{
          type = $_.Type
          status = $_.Status
          pid = $(if ($isOwned) { $_.Process } else { $null })
          tid = $(if ($isOwned) { $_.Thread } else { $null })
        }
      })
      [pscustomobject]@{
        tid = $thread.Id; state = $state; reason = $reason
        chainOk = $chain.Ok; chainError = $chain.Error; cycle = $chain.Cycle; nodes = $nodes
      }
    })
    ConvertTo-Json -Compress -Depth 7 -InputObject ([pscustomobject]@{
      pid = $p.pid; threadCount = $threads.Count; truncated = $threads.Count -gt 128; threads = $details
    })
  } catch {
    ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ pid = $p.pid; state = 'unavailable' })
  }
}
