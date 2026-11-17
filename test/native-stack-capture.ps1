# Temporary stack-only probe for one owned Electron process. It never attaches
# a debugger, writes a dump, enables privileges, or terminates the target.
param([uint32]$RootPid, [switch]$WaitForCapture, [switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'

function Write-Observation([object]$Value) {
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 8 -InputObject $Value))
  [Console]::Out.Flush()
}

Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture-script'; state = 'started' })
Write-Observation ([pscustomobject]@{ observerPhase = 'process-inventory'; state = 'started' })
$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)
Write-Observation ([pscustomobject]@{ observerPhase = 'process-inventory'; state = 'completed' })
$owned = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$owned.Add($RootPid)
do {
  $added = $false
  foreach ($p in $all) {
    if ($owned.Contains([uint32]$p.ParentProcessId) -and $owned.Add([uint32]$p.ProcessId)) {
      $added = $true
    }
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
  [pscustomobject]@{ kind = $kind }
})
$counts = @($tree | Group-Object kind | ForEach-Object {
  [pscustomobject]@{ kind = $_.Name; count = $_.Count }
})
Write-Observation ([pscustomobject]@{ observerPhase = 'owned-process-tree'; kinds = $counts })

Write-Observation ([pscustomobject]@{ observerPhase = 'electron-target-selection'; state = 'started' })
$electronProcesses = @($all | Where-Object {
  $owned.Contains([uint32]$_.ProcessId) -and $_.Name -ieq 'electron.exe'
})
$electronIds = New-Object 'System.Collections.Generic.HashSet[uint32]'
foreach ($electron in $electronProcesses) {
  [void]$electronIds.Add([uint32]$electron.ProcessId)
}
$targets = @($electronProcesses | Where-Object {
  -not $electronIds.Contains([uint32]$_.ParentProcessId)
})
Write-Observation ([pscustomobject]@{ observerPhase = 'electron-target-selection'; state = 'completed' })
Write-Observation ([pscustomobject]@{ observerPhase = 'native-helper-compilation'; state = 'started' })
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

[StructLayout(LayoutKind.Sequential)]
public struct NativeAddress64 {
  public ulong Offset;
  public ushort Segment;
  public uint Mode;
}

[StructLayout(LayoutKind.Sequential)]
public struct NativeKdHelp64 {
  public ulong Thread;
  public uint ThCallbackStack, ThCallbackBStore, NextCallback, FramePointer;
  public ulong KiCallUserMode, KeUserCallbackDispatcher, SystemRangeStart;
  public ulong KiUserExceptionDispatcher, StackBase, StackLimit;
  public uint BuildVersion, RetpolineStubFunctionTableSize;
  public ulong RetpolineStubFunctionTable;
  public uint RetpolineStubOffset, RetpolineStubSize;
  public ulong Reserved0, Reserved1;
}

[StructLayout(LayoutKind.Sequential)]
public struct NativeStackFrame64 {
  public NativeAddress64 AddrPC, AddrReturn, AddrFrame, AddrStack, AddrBStore;
  public IntPtr FuncTableEntry;
  [MarshalAs(UnmanagedType.ByValArray, SizeConst = 4)]
  public ulong[] Params;
  public int Far, Virtual;
  [MarshalAs(UnmanagedType.ByValArray, SizeConst = 3)]
  public ulong[] Reserved;
  public NativeKdHelp64 KdHelp;
}

[StructLayout(LayoutKind.Sequential)]
public struct NativeFileTime {
  public uint Low, High;
}

[StructLayout(LayoutKind.Sequential)]
public struct NativePssThreadEntry {
  public uint ExitStatus;
  public IntPtr TebBaseAddress;
  public uint ProcessId, ThreadId;
  public UIntPtr AffinityMask;
  public int Priority, BasePriority;
  public IntPtr LastSyscallFirstArgument;
  public ushort LastSyscallNumber;
  public NativeFileTime CreateTime, ExitTime, KernelTime, UserTime;
  public IntPtr Win32StartAddress;
  public NativeFileTime CaptureTime;
  public uint Flags;
  public ushort SuspendCount, SizeOfContextRecord;
  public IntPtr ContextRecord;
}

[StructLayout(LayoutKind.Sequential)]
public struct NativeSymbolInfo64 {
  public uint SizeOfStruct, TypeIndex;
  public ulong Reserved0, Reserved1;
  public uint Index, Size;
  public ulong ModBase;
  public uint Flags;
  public ulong Value, Address;
  public uint Register, Scope, Tag, NameLen, MaxNameLen;
  public byte Name;
}

[StructLayout(LayoutKind.Sequential)]
public struct NativeContext64Prefix {
  public ulong P1Home, P2Home, P3Home, P4Home, P5Home, P6Home;
  public uint ContextFlags, MxCsr;
  public ushort SegCs, SegDs, SegEs, SegFs, SegGs, SegSs;
  public uint EFlags;
  public ulong Dr0, Dr1, Dr2, Dr3, Dr6, Dr7;
  public ulong Rax, Rcx, Rdx, Rbx, Rsp, Rbp, Rsi, Rdi;
  public ulong R8, R9, R10, R11, R12, R13, R14, R15, Rip;
}

public sealed class NativeStackFrameRecord {
  public string Module { get; set; }
  public string Function { get; set; }
}

public sealed class NativeThreadStackRecord {
  public int Ordinal { get; set; }
  public NativeStackFrameRecord[] Frames { get; set; }
}

public sealed class NativeStackCaptureRecord {
  public string State { get; set; }
  public int ThreadCount { get; set; }
  public bool Truncated { get; set; }
  public int ElapsedMs { get; set; }
  public NativeThreadStackRecord[] Threads { get; set; }
}

public static class NativeStackCapture {
  private const uint ProcessVmOperation = 0x0008;
  private const uint ProcessVmRead = 0x0010;
  private const uint ProcessDupHandle = 0x0040;
  private const uint ProcessQueryInformation = 0x0400;
  private const uint ThreadQueryLimitedInformation = 0x0800;
  private const uint PssCaptureThreads = 0x00000080;
  private const uint PssCaptureThreadContext = 0x00000100;
  private const uint PssWalkThreads = 3;
  private const uint ContextControlIntegerAmd64 = 0x00100003;
  private const uint ErrorNoMoreItems = 259;
  private const uint MachineAmd64 = 0x8664;
  private const uint SymoptUndname = 0x00000002;
  private const uint SymoptDeferredLoads = 0x00000004;
  private const uint SymoptFailCriticalErrors = 0x00000200;
  private const uint SymoptNoPrompts = 0x00080000;
  private const int MaximumThreads = 64;
  private const int MaximumFramesPerThread = 32;
  private const int SymbolNameCapacity = 256;
  private const int SymbolNameLengthOffset = 76;
  private const int SymbolNameCapacityOffset = 80;
  private const int SymbolNameOffset = 84;
  private const int ContextRspOffset = 152;
  private const int ContextRbpOffset = 160;
  private const int ContextRipOffset = 248;
  private const int AddressModeOffset = 12;

  private static readonly Regex ModulePattern =
    new Regex(@"^[A-Za-z0-9_.-]{1,64}$", RegexOptions.CultureInvariant);
  private static readonly Regex FunctionPattern =
    new Regex(@"^[A-Za-z0-9_$!?<>:.+~\-]{1,96}$", RegexOptions.CultureInvariant);

  [UnmanagedFunctionPointer(CallingConvention.Winapi)]
  private delegate IntPtr FunctionTableAccessCallback(IntPtr process, ulong address);
  [UnmanagedFunctionPointer(CallingConvention.Winapi)]
  private delegate ulong ModuleBaseCallback(IntPtr process, ulong address);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenThread(uint access, bool inherit, uint threadId);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool IsWow64Process2(
    IntPtr process, out ushort processMachine, out ushort nativeMachine);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint PssCaptureSnapshot(
    IntPtr process, uint captureFlags, uint contextFlags, out IntPtr snapshot);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint PssWalkMarkerCreate(IntPtr allocator, out IntPtr marker);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint PssWalkMarkerFree(IntPtr marker);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint PssWalkSnapshot(
    IntPtr snapshot, uint informationClass, IntPtr marker, IntPtr buffer, uint bufferLength);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint PssFreeSnapshot(IntPtr process, IntPtr snapshot);
  [DllImport("kernel32.dll", EntryPoint = "RtlMoveMemory")]
  private static extern void CopyMemory(IntPtr destination, IntPtr source, UIntPtr length);
  [DllImport("kernel32.dll", EntryPoint = "RtlZeroMemory")]
  private static extern void ZeroMemory(IntPtr destination, UIntPtr length);

  [DllImport("dbghelp.dll", CharSet = CharSet.Ansi, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SymInitialize(IntPtr process, string searchPath, bool invadeProcess);
  [DllImport("dbghelp.dll")]
  private static extern uint SymSetOptions(uint options);
  [DllImport("dbghelp.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SymCleanup(IntPtr process);
  [DllImport("dbghelp.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SymFromAddr(IntPtr process, ulong address, IntPtr displacement, IntPtr symbol);
  [DllImport("dbghelp.dll")]
  private static extern IntPtr SymFunctionTableAccess64(IntPtr process, ulong address);
  [DllImport("dbghelp.dll")]
  private static extern ulong SymGetModuleBase64(IntPtr process, ulong address);
  [DllImport("dbghelp.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool StackWalk64(
    uint machineType, IntPtr process, IntPtr thread, IntPtr stackFrame,
    IntPtr contextRecord, IntPtr readMemoryRoutine, IntPtr functionTableAccessRoutine,
    IntPtr getModuleBaseRoutine, IntPtr translateAddress);
  [DllImport("psapi.dll", CharSet = CharSet.Unicode, EntryPoint = "GetModuleFileNameExW")]
  private static extern uint GetModuleFileNameEx(
    IntPtr process, IntPtr module, StringBuilder fileName, uint size);

  private static IntPtr FunctionTableAccess(IntPtr process, ulong address) {
    return SymFunctionTableAccess64(process, address);
  }
  private static ulong ModuleBase(IntPtr process, ulong address) {
    return SymGetModuleBase64(process, address);
  }

  public static bool ValidateLayouts() {
    return IntPtr.Size == 8 &&
      Marshal.SizeOf(typeof(NativeAddress64)) == 16 &&
      Marshal.OffsetOf(typeof(NativeAddress64), "Segment").ToInt32() == 8 &&
      Marshal.OffsetOf(typeof(NativeAddress64), "Mode").ToInt32() == AddressModeOffset &&
      Marshal.SizeOf(typeof(NativeKdHelp64)) == 112 &&
      Marshal.SizeOf(typeof(NativeStackFrame64)) == 264 &&
      Marshal.OffsetOf(typeof(NativeStackFrame64), "AddrFrame").ToInt32() == 32 &&
      Marshal.OffsetOf(typeof(NativeStackFrame64), "AddrStack").ToInt32() == 48 &&
      Marshal.SizeOf(typeof(NativePssThreadEntry)) == 120 &&
      Marshal.OffsetOf(typeof(NativePssThreadEntry), "ThreadId").ToInt32() == 20 &&
      Marshal.OffsetOf(typeof(NativePssThreadEntry), "SizeOfContextRecord").ToInt32() == 110 &&
      Marshal.OffsetOf(typeof(NativePssThreadEntry), "ContextRecord").ToInt32() == 112 &&
      Marshal.SizeOf(typeof(NativeSymbolInfo64)) == 88 &&
      Marshal.SizeOf(typeof(NativeContext64Prefix)) == 256 &&
      Marshal.OffsetOf(typeof(NativeContext64Prefix), "Rsp").ToInt32() == ContextRspOffset &&
      Marshal.OffsetOf(typeof(NativeContext64Prefix), "Rbp").ToInt32() == ContextRbpOffset &&
      Marshal.OffsetOf(typeof(NativeContext64Prefix), "Rip").ToInt32() == ContextRipOffset &&
      Marshal.OffsetOf(typeof(NativeSymbolInfo64), "NameLen").ToInt32() == SymbolNameLengthOffset &&
      Marshal.OffsetOf(typeof(NativeSymbolInfo64), "MaxNameLen").ToInt32() == SymbolNameCapacityOffset &&
      Marshal.OffsetOf(typeof(NativeSymbolInfo64), "Name").ToInt32() == SymbolNameOffset;
  }

  public static string SanitizeModule(string value) {
    if (String.IsNullOrEmpty(value)) return "unknown";
    string name = Path.GetFileName(value);
    return ModulePattern.IsMatch(name) ? name : "unknown";
  }

  public static string SanitizeFunction(string value) {
    if (String.IsNullOrEmpty(value)) return null;
    int argumentStart = value.IndexOf('(');
    if (argumentStart >= 0) value = value.Substring(0, argumentStart);
    return FunctionPattern.IsMatch(value) ? value : null;
  }

  private static NativeStackFrameRecord DescribeFrame(IntPtr process, ulong address, IntPtr symbol) {
    string moduleName = "unknown";
    ulong moduleBase = SymGetModuleBase64(process, address);
    if (moduleBase != 0) {
      StringBuilder path = new StringBuilder(512);
      uint length = GetModuleFileNameEx(
        process, new IntPtr(unchecked((long)moduleBase)), path, (uint)path.Capacity);
      if (length > 0 && length < path.Capacity)
        moduleName = SanitizeModule(path.ToString());
    }

    string functionName = null;
    ZeroMemory(symbol, new UIntPtr((uint)(Marshal.SizeOf(typeof(NativeSymbolInfo64)) + SymbolNameCapacity - 1)));
    Marshal.WriteInt32(symbol, 0, Marshal.SizeOf(typeof(NativeSymbolInfo64)));
    Marshal.WriteInt32(symbol, SymbolNameCapacityOffset, SymbolNameCapacity);
    if (SymFromAddr(process, address, IntPtr.Zero, symbol)) {
      int nameLength = Marshal.ReadInt32(symbol, SymbolNameLengthOffset);
      if (nameLength > 0 && nameLength < SymbolNameCapacity)
        functionName = SanitizeFunction(
          Marshal.PtrToStringAnsi(IntPtr.Add(symbol, SymbolNameOffset), nameLength));
    }
    return new NativeStackFrameRecord { Module = moduleName, Function = functionName };
  }

  private static void WritePhase(string phase, string state) {
    Console.Out.WriteLine("{\"observerPhase\":\"" + phase + "\",\"state\":\"" + state + "\"}");
    Console.Out.Flush();
  }

  private static void WriteThread(NativeThreadStackRecord thread) {
    StringBuilder json = new StringBuilder();
    json.Append("{\"observerPhase\":\"thread-stack\",\"ordinal\":");
    json.Append(thread.Ordinal);
    json.Append(",\"frames\":[");
    for (int index = 0; index < thread.Frames.Length; index++) {
      if (index > 0) json.Append(',');
      NativeStackFrameRecord frame = thread.Frames[index];
      // Both strings have already passed the strict basename/function allowlists.
      json.Append("{\"module\":\"").Append(frame.Module).Append('"');
      if (frame.Function != null)
        json.Append(",\"function\":\"").Append(frame.Function).Append('"');
      json.Append('}');
    }
    json.Append("]}");
    Console.Out.WriteLine(json.ToString());
    Console.Out.Flush();
  }

  private static List<NativeStackFrameRecord> WalkThread(
    IntPtr process, NativePssThreadEntry entry, IntPtr functionTable, IntPtr moduleBase,
    Stopwatch timer, int budgetMs, ref bool budgetExpired) {
    List<NativeStackFrameRecord> frames = new List<NativeStackFrameRecord>();
    if (entry.ContextRecord == IntPtr.Zero ||
        entry.SizeOfContextRecord < Marshal.SizeOf(typeof(NativeContext64Prefix)))
      return frames;

    IntPtr thread = OpenThread(ThreadQueryLimitedInformation, false, entry.ThreadId);
    if (thread == IntPtr.Zero) return frames;
    IntPtr context = IntPtr.Zero;
    IntPtr stackFrame = IntPtr.Zero;
    IntPtr symbol = IntPtr.Zero;
    try {
      context = Marshal.AllocHGlobal(entry.SizeOfContextRecord);
      CopyMemory(context, entry.ContextRecord, new UIntPtr(entry.SizeOfContextRecord));
      stackFrame = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativeStackFrame64)));
      ZeroMemory(stackFrame, new UIntPtr((uint)Marshal.SizeOf(typeof(NativeStackFrame64))));
      Marshal.WriteInt64(stackFrame, 0, Marshal.ReadInt64(context, ContextRipOffset));
      Marshal.WriteInt32(stackFrame, AddressModeOffset, 3);
      Marshal.WriteInt64(stackFrame, 32, Marshal.ReadInt64(context, ContextRbpOffset));
      Marshal.WriteInt32(stackFrame, 32 + AddressModeOffset, 3);
      Marshal.WriteInt64(stackFrame, 48, Marshal.ReadInt64(context, ContextRspOffset));
      Marshal.WriteInt32(stackFrame, 48 + AddressModeOffset, 3);
      Marshal.WriteInt32(stackFrame, 64 + AddressModeOffset, 3);
      symbol = Marshal.AllocHGlobal(
        Marshal.SizeOf(typeof(NativeSymbolInfo64)) + SymbolNameCapacity - 1);

      ulong previousStack = 0;
      for (int index = 0; index < MaximumFramesPerThread; index++) {
        if (timer.ElapsedMilliseconds >= budgetMs) {
          budgetExpired = true;
          break;
        }
        if (!StackWalk64(
          MachineAmd64, process, thread, stackFrame, context, IntPtr.Zero,
          functionTable, moduleBase, IntPtr.Zero)) {
          if (frames.Count == 0)
            frames.Add(DescribeFrame(
              process, unchecked((ulong)Marshal.ReadInt64(context, ContextRipOffset)), symbol));
          break;
        }
        ulong programCounter = unchecked((ulong)Marshal.ReadInt64(stackFrame, 0));
        ulong stackPointer = unchecked((ulong)Marshal.ReadInt64(stackFrame, 48));
        if (programCounter == 0 || (index > 0 && stackPointer <= previousStack)) break;
        frames.Add(DescribeFrame(process, programCounter, symbol));
        previousStack = stackPointer;
      }
    } finally {
      if (symbol != IntPtr.Zero) Marshal.FreeHGlobal(symbol);
      if (stackFrame != IntPtr.Zero) Marshal.FreeHGlobal(stackFrame);
      if (context != IntPtr.Zero) Marshal.FreeHGlobal(context);
      CloseHandle(thread);
    }
    return frames;
  }

  public static IntPtr PinProcess(uint processId) {
    IntPtr process = OpenProcess(
      ProcessQueryInformation | ProcessVmRead | ProcessVmOperation | ProcessDupHandle,
      false, processId);
    if (process == IntPtr.Zero) return IntPtr.Zero;
    ushort processMachine, nativeMachine;
    if (!IsWow64Process2(process, out processMachine, out nativeMachine) ||
        processMachine != 0 || nativeMachine != MachineAmd64) {
      CloseHandle(process);
      return IntPtr.Zero;
    }
    return process;
  }

  public static void ReleaseProcess(IntPtr process) {
    if (process != IntPtr.Zero) CloseHandle(process);
  }

  public static NativeStackCaptureRecord Capture(IntPtr process, int budgetMs) {
    Stopwatch timer = Stopwatch.StartNew();
    NativeStackCaptureRecord result = new NativeStackCaptureRecord {
      State = "unavailable", Threads = new NativeThreadStackRecord[0]
    };
    IntPtr snapshot = IntPtr.Zero;
    IntPtr marker = IntPtr.Zero;
    bool symbolsInitialized = false;
    try {
      // Capture thread metadata and control/integer registers only. In
      // particular, no VA clone, VA-space, handles, or dump is requested.
      WritePhase("thread-snapshot", "started");
      uint status = PssCaptureSnapshot(
        process, PssCaptureThreads | PssCaptureThreadContext, ContextControlIntegerAmd64, out snapshot);
      if (status != 0 || snapshot == IntPtr.Zero) {
        result.State = "snapshot-unavailable";
        return result;
      }
      WritePhase("thread-snapshot", "completed");

      status = PssWalkMarkerCreate(IntPtr.Zero, out marker);
      if (status != 0 || marker == IntPtr.Zero) {
        result.State = "walk-marker-unavailable";
        return result;
      }

      // Do not inherit ambient symbol-server paths. An empty path prevents
      // network symbol retrieval; DbgHelp still resolves loaded-module names.
      Environment.SetEnvironmentVariable("_NT_SYMBOL_PATH", String.Empty);
      Environment.SetEnvironmentVariable("_NT_ALTERNATE_SYMBOL_PATH", String.Empty);
      SymSetOptions(SymoptUndname | SymoptDeferredLoads |
        SymoptFailCriticalErrors | SymoptNoPrompts);
      WritePhase("symbol-initialization", "started");
      if (!SymInitialize(process, String.Empty, true)) {
        result.State = "symbols-unavailable";
        return result;
      }
      symbolsInitialized = true;
      WritePhase("symbol-initialization", "completed");

      FunctionTableAccessCallback functionTableCallback = FunctionTableAccess;
      ModuleBaseCallback moduleBaseCallback = ModuleBase;
      IntPtr functionTable = Marshal.GetFunctionPointerForDelegate(functionTableCallback);
      IntPtr moduleBase = Marshal.GetFunctionPointerForDelegate(moduleBaseCallback);
      IntPtr entryBuffer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(NativePssThreadEntry)));
      List<NativeThreadStackRecord> threads = new List<NativeThreadStackRecord>();
      bool truncated = false;
      bool budgetExpired = false;
      try {
        while (timer.ElapsedMilliseconds < budgetMs) {
          if (threads.Count >= MaximumThreads) {
            status = PssWalkSnapshot(snapshot, PssWalkThreads, marker, entryBuffer,
              (uint)Marshal.SizeOf(typeof(NativePssThreadEntry)));
            truncated = status == 0;
            break;
          }

          status = PssWalkSnapshot(snapshot, PssWalkThreads, marker, entryBuffer,
            (uint)Marshal.SizeOf(typeof(NativePssThreadEntry)));
          if (status == ErrorNoMoreItems) break;
          if (status != 0) {
            result.State = status == 24 ? "walk-bad-length" :
              status == 87 ? "walk-invalid-parameter" :
              status == 1168 ? "walk-data-not-found" : "walk-unavailable";
            break;
          }

          NativePssThreadEntry entry = (NativePssThreadEntry)Marshal.PtrToStructure(
            entryBuffer, typeof(NativePssThreadEntry));
          int ordinal = threads.Count;
          List<NativeStackFrameRecord> frames = WalkThread(
            process, entry, functionTable, moduleBase, timer, budgetMs, ref budgetExpired);
          NativeThreadStackRecord thread = new NativeThreadStackRecord {
            Ordinal = ordinal, Frames = frames.ToArray()
          };
          threads.Add(thread);
          WriteThread(thread);
          if (budgetExpired) break;
        }
      } finally {
        Marshal.FreeHGlobal(entryBuffer);
        GC.KeepAlive(functionTableCallback);
        GC.KeepAlive(moduleBaseCallback);
      }

      result.Threads = threads.ToArray();
      result.ThreadCount = threads.Count;
      result.Truncated = truncated;
      if (budgetExpired || timer.ElapsedMilliseconds >= budgetMs)
        result.State = "budget-exhausted";
      else if (result.State == "unavailable")
        result.State = "completed";
      return result;
    } catch {
      result.State = "unavailable";
      return result;
    } finally {
      if (marker != IntPtr.Zero) PssWalkMarkerFree(marker);
      if (symbolsInitialized) SymCleanup(process);
      if (snapshot != IntPtr.Zero) PssFreeSnapshot(GetCurrentProcess(), snapshot);
      result.ElapsedMs = (int)timer.ElapsedMilliseconds;
    }
  }
}
'@
Write-Observation ([pscustomobject]@{ observerPhase = 'native-helper-compilation'; state = 'completed' })

if (-not [NativeStackCapture]::ValidateLayouts() -or
    [NativeStackCapture]::SanitizeModule('C:\synthetic\kernelbase.dll') -ne 'kernelbase.dll' -or
    [NativeStackCapture]::SanitizeFunction('DispatchMessageW(secret argument)') -ne 'DispatchMessageW' -or
    $null -ne [NativeStackCapture]::SanitizeFunction('C:\synthetic\private-path')) {
  Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture'; state = 'validation-failed' })
  exit 0
}
Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture-validation'; state = 'passed' })
if ($ValidateOnly) { return }
if ([Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString() -ne 'X64') {
  Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture'; state = 'unsupported-architecture' })
  exit 0
}
if ($targets.Count -ne 1) {
  Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture'; state = 'target-not-unique' })
  exit 0
}

Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture-started' })
$processHandle = [NativeStackCapture]::PinProcess([uint32]$targets[0].ProcessId)
if ($processHandle -eq [IntPtr]::Zero) {
  Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture'; state = 'process-unavailable' })
  exit 0
}
try {
  if ($WaitForCapture) {
    Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture-ready' })
    if ([Console]::In.ReadLine() -cne 'capture') {
      Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture'; state = 'cancelled' })
      return
    }
  }
  Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture-triggered' })
  # Diagnostic sampling only: the second sample observes the steady hang state.
  foreach ($sample in 0, 1) {
    if ($sample -gt 0) { Start-Sleep -Milliseconds 3000 }
    Write-Observation ([pscustomobject]@{ observerPhase = 'stack-capture-sample'; sample = $sample })
    $capture = [NativeStackCapture]::Capture($processHandle, 3500)
    Write-Observation ([pscustomobject]@{
      observerPhase = 'stack-capture-result'
      sample = $sample
      state = $capture.State
      threadCount = $capture.ThreadCount
      truncated = $capture.Truncated
      elapsedMs = $capture.ElapsedMs
    })
  }
} finally {
  [NativeStackCapture]::ReleaseProcess($processHandle)
}
