// Node/Electron-ABI-independent Windows primitives. No provider or ACP logic lives here.
#define NOMINMAX
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <tlhelp32.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

struct Handle {
  HANDLE value = INVALID_HANDLE_VALUE;
  explicit Handle(HANDLE h = INVALID_HANDLE_VALUE) : value(h) {}
  ~Handle() { if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
};

[[noreturn]] void fail(const char* operation) {
  throw std::runtime_error(std::string(operation) + " (Windows error " +
                           std::to_string(GetLastError()) + ")");
}

std::string utf8(const std::wstring& value) {
  if (value.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                                static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (!size) fail("Invalid Unicode");
  std::string result(size, '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
                      static_cast<int>(value.size()), result.data(), size, nullptr, nullptr);
  return result;
}

std::string json(const std::wstring& value) {
  std::string result = "\"";
  for (unsigned char c : utf8(value)) {
    if (c == '"' || c == '\\') { result += '\\'; result += static_cast<char>(c); }
    else if (c < 32) {
      char escaped[7];
      std::snprintf(escaped, sizeof(escaped), "\\u%04x", c);
      result += escaped;
    } else result += static_cast<char>(c);
  }
  return result + '"';
}

void write(HANDLE output, const std::string& data) {
  size_t offset = 0;
  while (offset < data.size()) {
    DWORD written = 0;
    if (!WriteFile(output, data.data() + offset,
                   static_cast<DWORD>(data.size() - offset), &written, nullptr) || !written)
      fail("Write failed");
    offset += written;
  }
}

void controlWrite(HANDLE output, const std::string& data) {
  Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
  OVERLAPPED operation{};
  operation.hEvent = event.value;
  DWORD count = 0;
  if (!WriteFile(output, data.data(), static_cast<DWORD>(data.size()), &count, &operation)) {
    if (GetLastError() != ERROR_IO_PENDING ||
        WaitForSingleObject(event.value, 5000) != WAIT_OBJECT_0) {
      CancelIoEx(output, &operation);
      GetOverlappedResult(output, &operation, &count, TRUE);
      fail("Control write deadline exceeded");
    }
    if (!GetOverlappedResult(output, &operation, &count, FALSE)) fail("Control write failed");
  }
  if (count != data.size()) throw std::runtime_error("Incomplete control write");
}

uint64_t timeValue(FILETIME t) {
  return (static_cast<uint64_t>(t.dwHighDateTime) << 32) | t.dwLowDateTime;
}

std::wstring sidOf(HANDLE process) {
  HANDLE raw = nullptr;
  if (!OpenProcessToken(process, TOKEN_QUERY, &raw)) fail("Cannot inspect process owner");
  Handle token(raw);
  DWORD size = 0;
  GetTokenInformation(token.value, TokenUser, nullptr, 0, &size);
  std::vector<BYTE> data(size);
  if (!GetTokenInformation(token.value, TokenUser, data.data(), size, &size))
    fail("Cannot inspect process owner");
  LPWSTR text = nullptr;
  if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(data.data())->User.Sid, &text))
    fail("Cannot encode process owner");
  std::wstring result(text);
  LocalFree(text);
  return result;
}

std::string creationOf(HANDLE process) {
  FILETIME created{}, exit{}, kernel{}, user{};
  if (!GetProcessTimes(process, &created, &exit, &kernel, &user))
    fail("Cannot inspect process creation time");
  return std::to_string(timeValue(created));
}

std::string identity(HANDLE process) {
  return "\"createdAt\":\"" + creationOf(process) + "\",\"owner\":" + json(sidOf(process));
}

DWORD number(const wchar_t* text) {
  wchar_t* end = nullptr;
  unsigned long value = std::wcstoul(text, &end, 10);
  if (!value || !end || *end) throw std::runtime_error("Invalid process ID");
  return value;
}

struct Security {
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), nullptr, FALSE};
  Security() {
    const std::wstring owner = sidOf(GetCurrentProcess());
    std::wstring sddl = L"O:" + owner + L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;" + owner + L")";
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
          sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) fail("Cannot establish privacy");
    attributes.lpSecurityDescriptor = descriptor;
  }
  ~Security() { LocalFree(descriptor); }
};

std::wstring fullPath(const std::wstring& path) {
  // Deliberately do not opt the helper into long paths. The first release fails clearly
  // when Windows long-path support is disabled, rather than changing machine policy.
  if (path.empty() || path.find(L'\0') != std::wstring::npos ||
      path.rfind(L"\\\\", 0) == 0 || path.size() > 247 ||
      path.size() < 3 || path[1] != L':' || (path[2] != L'\\' && path[2] != L'/') ||
      path.find(L':', 2) != std::wstring::npos)
    throw std::runtime_error("Unsupported Windows path (use a local absolute path below 248 characters)");
  wchar_t result[MAX_PATH];
  DWORD length = GetFullPathNameW(path.c_str(), MAX_PATH, result, nullptr);
  if (!length || length >= MAX_PATH) fail("Unsupported Windows path");
  return result;
}

void verifyPrivate(const std::wstring& path) {
  PACL acl = nullptr;
  PSID owner = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  DWORD error = GetNamedSecurityInfoW(path.c_str(), SE_FILE_OBJECT,
    OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION, &owner, nullptr, &acl,
    nullptr, &descriptor);
  if (error != ERROR_SUCCESS) { SetLastError(error); fail("Cannot verify private object"); }
  std::unique_ptr<void, decltype(&LocalFree)> guard(descriptor, LocalFree);
  const std::wstring current = sidOf(GetCurrentProcess());
  PSID currentSid = nullptr;
  if (!ConvertStringSidToSidW(current.c_str(), &currentSid)) fail("Cannot verify private owner");
  std::unique_ptr<void, decltype(&LocalFree)> sidGuard(currentSid, LocalFree);
  if (!owner || !EqualSid(owner, currentSid) || !acl)
    throw std::runtime_error("Code60-private object has an unsafe owner or ACL");
  BYTE systemBuffer[SECURITY_MAX_SID_SIZE];
  DWORD systemSize = sizeof(systemBuffer);
  if (!CreateWellKnownSid(WinLocalSystemSid, nullptr, systemBuffer, &systemSize))
    fail("Cannot verify private ACL");
  bool userAccess = false;
  for (DWORD i = 0; i < acl->AceCount; ++i) {
    void* raw = nullptr;
    if (!GetAce(acl, i, &raw)) fail("Cannot verify private ACL");
    auto header = static_cast<ACE_HEADER*>(raw);
    if (header->AceType == ACCESS_DENIED_ACE_TYPE) continue;
    if (header->AceType != ACCESS_ALLOWED_ACE_TYPE)
      throw std::runtime_error("Code60-private object has an unsupported ACL");
    auto ace = static_cast<ACCESS_ALLOWED_ACE*>(raw);
    PSID sid = &ace->SidStart;
    if (!EqualSid(sid, currentSid) && !EqualSid(sid, systemBuffer))
      throw std::runtime_error("Code60-private object is accessible to another account; refusing to write");
    if (EqualSid(sid, currentSid) && !(header->AceFlags & INHERIT_ONLY_ACE) &&
        (ace->Mask & FILE_ALL_ACCESS) == FILE_ALL_ACCESS) userAccess = true;
  }
  if (!userAccess) throw std::runtime_error("Code60-private object lacks owner access");
}

std::wstring quote(const std::wstring& value) {
  std::wstring result = L"\"";
  size_t slashes = 0;
  for (wchar_t c : value) {
    if (c == L'\\') { ++slashes; continue; }
    result.append(slashes * (c == L'"' ? 2 : 1), L'\\');
    slashes = 0;
    if (c == L'"') result += L'\\';
    result += c;
  }
  result.append(slashes * 2, L'\\');
  return result + L'"';
}

bool jobEmpty(HANDLE job) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info{};
  if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &info,
                                 sizeof(info), nullptr)) fail("Cannot verify job exit");
  return info.ActiveProcesses == 0;
}

void drainJob(HANDLE job) {
  if (!TerminateJobObject(job, 1)) fail("Cannot terminate owned job");
  ULONGLONG deadline = GetTickCount64() + 5000;
  while (!jobEmpty(job)) {
    if (GetTickCount64() >= deadline) throw std::runtime_error("Owned job cleanup exceeded five seconds");
    Sleep(10);
  }
}

int runAgent(int argc, wchar_t** argv) {
  if (argc < 6) throw std::runtime_error("Invalid launch");
  const std::wstring pipeName(argv[2]);
  const std::wstring jobName(argv[3]);
  if (pipeName.rfind(L"\\\\.\\pipe\\code60-", 0) != 0 ||
      jobName.rfind(L"Local\\Code60-", 0) != 0) throw std::runtime_error("Invalid control endpoint");
  const DWORD ownerPid = number(argv[4]);
  Handle owner(OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, ownerPid));
  if (!owner.value) fail("Cannot monitor owner");
  // Obtain the control token from the launch environment, never ACP or the command line.
  wchar_t token[129]{};
  DWORD tokenSize = GetEnvironmentVariableW(L"CODE60_HOST_CONTROL_TOKEN", token, 129);
  SetEnvironmentVariableW(L"CODE60_HOST_CONTROL_TOKEN", nullptr);
  if (tokenSize != 64) throw std::runtime_error("Invalid control token");
  const ULONGLONG deadline = GetTickCount64() + 5000;
  HANDLE rawControl = INVALID_HANDLE_VALUE;
  do {
    rawControl = CreateFileW(pipeName.c_str(), GENERIC_READ | GENERIC_WRITE, 0,
                             nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
    if (rawControl != INVALID_HANDLE_VALUE) break;
    Sleep(10);
  } while (GetTickCount64() < deadline &&
           WaitForSingleObject(owner.value, 0) == WAIT_TIMEOUT);
  Handle control(rawControl);
  if (control.value == INVALID_HANDLE_VALUE) fail("Cannot connect owner control channel");
  Security security;
  Handle job(CreateJobObjectW(&security.attributes, jobName.c_str()));
  if (!job.value || GetLastError() == ERROR_ALREADY_EXISTS) fail("Cannot create exclusive owned job");
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job.value, JobObjectExtendedLimitInformation,
                               &limits, sizeof(limits))) fail("Cannot configure owned job");
  std::wstring command;
  for (int i = 5; i < argc; ++i) {
    if (i != 5) command += L' ';
    command += quote(argv[i]);
  }
  if (argc == 11 && _wcsicmp(argv[6], L"/d") == 0 &&
      _wcsicmp(argv[7], L"/s") == 0 && _wcsicmp(argv[8], L"/v:off") == 0 &&
      _wcsicmp(argv[9], L"/c") == 0) {
    const std::wstring executable(argv[5]);
    const size_t slash = executable.find_last_of(L"\\/");
    if (_wcsicmp(executable.substr(slash + 1).c_str(), L"cmd.exe") == 0)
      command = quote(executable) + L" /d /s /v:off /c " + argv[10];
  }
  // Duplicate only ACP's three standard handles. The job, owner and control handles
  // are never inherited by the provider or its tools.
  HANDLE handles[3]{};
  for (int i = 0; i < 3; ++i) {
    const DWORD standard[] = {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE};
    if (!DuplicateHandle(GetCurrentProcess(), GetStdHandle(standard[i]), GetCurrentProcess(),
                         &handles[i], 0, TRUE, DUPLICATE_SAME_ACCESS)) fail("Cannot prepare agent stdio");
  }
  Handle input(handles[0]), output(handles[1]), error(handles[2]);
  SIZE_T attributeSize = 0;
  InitializeProcThreadAttributeList(nullptr, 1, 0, &attributeSize);
  std::vector<BYTE> attributeBuffer(attributeSize);
  auto attributes = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributeBuffer.data());
  if (!InitializeProcThreadAttributeList(attributes, 1, 0, &attributeSize))
    fail("Cannot restrict handle inheritance");
  if (!UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                handles, sizeof(handles), nullptr, nullptr))
    fail("Cannot restrict handle inheritance");
  STARTUPINFOEXW startup{};
  startup.StartupInfo.cb = sizeof(startup);
  startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
  startup.StartupInfo.hStdInput = handles[0];
  startup.StartupInfo.hStdOutput = handles[1];
  startup.StartupInfo.hStdError = handles[2];
  startup.lpAttributeList = attributes;
  PROCESS_INFORMATION child{};
  BOOL created = CreateProcessW(argv[5], command.data(), nullptr, nullptr, TRUE,
    CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT, nullptr, nullptr,
    &startup.StartupInfo, &child);
  DeleteProcThreadAttributeList(attributes);
  if (!created) fail("Could not start agent");
  Handle process(child.hProcess), thread(child.hThread);
  if (!AssignProcessToJobObject(job.value, process.value)) {
    TerminateProcess(process.value, 1);
    fail("Cannot assign agent to owned job");
  }
  const std::string ready = "{\"version\":1,\"token\":" + json(token) +
    ",\"pid\":" + std::to_string(child.dwProcessId) + "," + identity(process.value) +
    ",\"job\":" + json(jobName) + "}\n";
  controlWrite(control.value, ready);
  if (ResumeThread(thread.value) == static_cast<DWORD>(-1)) fail("Cannot resume owned agent");
  const HANDLE jobHandle = job.value, ownerHandle = owner.value, controlHandle = control.value;
  std::thread([jobHandle, ownerHandle]() {
    WaitForSingleObject(ownerHandle, INFINITE);
    TerminateJobObject(jobHandle, 1);
  }).detach();
  std::thread([jobHandle, controlHandle]() {
    // Any stop request, malformed control traffic, or owner disconnect terminates
    // only this job. Control never shares the ACP streams.
    char request = 0;
    DWORD count = 0;
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    OVERLAPPED operation{};
    operation.hEvent = event.value;
    if (!ReadFile(controlHandle, &request, 1, &count, &operation) &&
        GetLastError() == ERROR_IO_PENDING)
      GetOverlappedResult(controlHandle, &operation, &count, TRUE);
    TerminateJobObject(jobHandle, 1);
  }).detach();
  WaitForSingleObject(process.value, INFINITE);
  DWORD code = 1;
  if (!GetExitCodeProcess(process.value, &code)) fail("Cannot read agent exit");
  drainJob(job.value); // Root exit cannot orphan tools that retained stdout.
  controlWrite(control.value, "{\"exit\":" + std::to_string(code) + ",\"stopped\":true}\n");
  // Detached monitors must not outlive their handles. ExitProcess closes the job,
  // even if a final control write or another thread failed.
  ExitProcess(0);
}

void ownedStatus(int argc, wchar_t** argv, bool stop) {
  if (argc != 6) throw std::runtime_error("Native identity is required");
  DWORD pid = number(argv[2]);
  const std::wstring jobName(argv[5]);
  if (jobName.rfind(L"Local\\Code60-", 0) != 0) throw std::runtime_error("Invalid owned job");
  Handle job(OpenJobObjectW(JOB_OBJECT_QUERY | (stop ? JOB_OBJECT_TERMINATE : 0), FALSE,
                            jobName.c_str()));
  if (!job.value) {
    if (GetLastError() == ERROR_FILE_NOT_FOUND) {
      write(GetStdHandle(STD_OUTPUT_HANDLE), "gone\n");
      return;
    }
    fail("Cannot verify owned job");
  }
  if (jobEmpty(job.value)) {
    write(GetStdHandle(STD_OUTPUT_HANDLE), "gone\n");
    return;
  }
  Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, pid));
  BOOL member = FALSE;
  if (!process.value || creationOf(process.value) != utf8(argv[3]) ||
      sidOf(process.value) != argv[4] ||
      !IsProcessInJob(process.value, job.value, &member) || !member)
    throw std::runtime_error("Native process/job identity cannot be verified; refusing operation");
  if (stop) drainJob(job.value);
  write(GetStdHandle(STD_OUTPUT_HANDLE), jobEmpty(job.value) ? "gone\n" : "alive\n");
}

struct CheckedPath {
  std::wstring path;
  std::vector<std::unique_ptr<Handle>> guards;
  CheckedPath(const std::wstring& root, const std::wstring& relative) : path(fullPath(root)) {
    if (relative.find_first_of(L"\\:\0") != std::wstring::npos ||
        (!relative.empty() && relative.front() == L'/'))
      throw std::runtime_error("Invalid browser-relative path");
    auto hold = [&]() {
      // No delete sharing: hold every ancestor until reading/listing is complete.
      // OPEN_REPARSE_POINT rejects junctions, mount points, and all other reparse tags.
      auto handle = std::make_unique<Handle>(CreateFileW(path.c_str(), FILE_READ_ATTRIBUTES,
        FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr));
      if (handle->value == INVALID_HANDLE_VALUE) fail("Cannot open path");
      BY_HANDLE_FILE_INFORMATION info{};
      if (!GetFileInformationByHandle(handle->value, &info)) fail("Cannot inspect path");
      if (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)
        throw std::runtime_error("Reparse points and symbolic links are not previewed");
      guards.push_back(std::move(handle));
    };
    // Guard every root ancestor as well, not merely the last root component.
    const std::wstring original = path;
    for (size_t i = 3; i < original.size(); ++i) {
      if (original[i] == L'\\') { path = original.substr(0, i); hold(); }
    }
    path = original;
    hold();
    size_t start = 0;
    while (start < relative.size()) {
      size_t end = relative.find(L'/', start);
      std::wstring part = relative.substr(start, end == std::wstring::npos ? end : end - start);
      if (part.empty() || part == L"." || part == L".." ||
          part.find_first_of(L"<>\"|?*") != std::wstring::npos ||
          part.back() == L'.' || part.back() == L' ')
        throw std::runtime_error("Invalid browser-relative path");
      path += L"\\" + part;
      path = fullPath(path);
      hold();
      if (end == std::wstring::npos) break;
      start = end + 1;
      if (start == relative.size()) throw std::runtime_error("Invalid browser-relative path");
    }
  }
};

std::wstring parentPath(const std::wstring& path) {
  const size_t slash = path.find_last_of(L'\\');
  return path.substr(0, slash == 2 ? 3 : slash);
}

void privateDirectory(const std::wstring& input, bool verify = true) {
  const std::wstring path = fullPath(input);
  if (GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES) {
    CheckedPath checked(path, L"");
    if (!(GetFileAttributesW(path.c_str()) & FILE_ATTRIBUTE_DIRECTORY))
      throw std::runtime_error("Private directory is not a regular directory");
    if (verify) verifyPrivate(path);
    return;
  }
  if (GetLastError() != ERROR_PATH_NOT_FOUND && GetLastError() != ERROR_FILE_NOT_FOUND)
    fail("Cannot inspect private directory");
  const auto parent = parentPath(path);
  if (parent == path) throw std::runtime_error("Cannot create a Windows volume root");
  privateDirectory(parent, false);
  CheckedPath ancestors(parent, L"");
  Security security;
  if (!CreateDirectoryW(path.c_str(), &security.attributes) &&
      GetLastError() != ERROR_ALREADY_EXISTS) fail("Cannot create private directory");
  CheckedPath checked(path, L"");
  if (!(GetFileAttributesW(path.c_str()) & FILE_ATTRIBUTE_DIRECTORY))
    throw std::runtime_error("Private directory is not a regular directory");
  verifyPrivate(path);
}

// Exclusive creation for lock directories: an existing path fails with Windows error 183.
void newPrivateDirectory(const std::wstring& input) {
  const std::wstring path = fullPath(input);
  CheckedPath ancestors(parentPath(path), L"");
  Security security;
  if (!CreateDirectoryW(path.c_str(), &security.attributes)) fail("Cannot create private directory");
  CheckedPath checked(path, L"");
  verifyPrivate(path);
}

void privateFile(const std::wstring& input, bool existing = false, bool contents = false) {
  const std::wstring path = fullPath(input);
  CheckedPath ancestors(parentPath(path), L"");
  Security security;
  Handle file(CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ,
    &security.attributes, existing ? OPEN_ALWAYS : CREATE_NEW,
    FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (file.value == INVALID_HANDLE_VALUE) fail("Cannot create private file");
  BY_HANDLE_FILE_INFORMATION info{};
  if (!GetFileInformationByHandle(file.value, &info)) fail("Cannot inspect private file");
  if (GetFileType(file.value) != FILE_TYPE_DISK ||
      (info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)))
    throw std::runtime_error("Private file is not a regular file");
  verifyPrivate(path);
  if (contents) {
    if (existing) {
      LARGE_INTEGER end{};
      if (!SetFilePointerEx(file.value, end, nullptr, FILE_END)) fail("Cannot append private file");
    }
    std::string buffer(64 * 1024, '\0');
    for (;;) {
      DWORD count = 0;
      if (!ReadFile(GetStdHandle(STD_INPUT_HANDLE), buffer.data(),
                    static_cast<DWORD>(buffer.size()), &count, nullptr)) {
        if (GetLastError() == ERROR_BROKEN_PIPE) break;
        fail("Cannot read private file contents");
      }
      if (!count) break;
      write(file.value, std::string(buffer.data(), count));
    }
  }
}

void atomicRename(const std::wstring& source, const std::wstring& destination) {
  const std::wstring from = fullPath(source), to = fullPath(destination);
  CheckedPath sourceParent(parentPath(from), L"");
  CheckedPath destinationParent(parentPath(to), L"");
  if (MoveFileExW(from.c_str(), to.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) return;
  DWORD error = GetLastError();
  const DWORD attributes = GetFileAttributesW(to.c_str());
  // MoveFileEx can report ACCESS_DENIED for a sharing violation. Probe DELETE
  // access to distinguish that case, never treating an arbitrary access denial
  // or a read-only destination as transient.
  if (error == ERROR_ACCESS_DENIED &&
      (attributes == INVALID_FILE_ATTRIBUTES || !(attributes & FILE_ATTRIBUTE_READONLY))) {
    DWORD sharing = ERROR_SUCCESS;
    bool denied = false;
    for (const auto& path : {from, to}) {
      Handle probe(CreateFileW(path.c_str(), DELETE,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
      if (probe.value == INVALID_HANDLE_VALUE) {
        const DWORD probeError = GetLastError();
        if (probeError == ERROR_ACCESS_DENIED) denied = true;
        if (probeError == ERROR_SHARING_VIOLATION || probeError == ERROR_LOCK_VIOLATION)
          sharing = probeError;
      }
    }
    if (!denied && sharing != ERROR_SUCCESS) error = sharing;
  }
  SetLastError(error);
  fail("Atomic replacement failed");
}

void preview(const std::wstring& root, const std::wstring& path) {
  CheckedPath checked(root, path);
  Handle file(CreateFileW(checked.path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
    nullptr, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, nullptr));
  if (file.value == INVALID_HANDLE_VALUE) fail("Cannot read preview");
  BY_HANDLE_FILE_INFORMATION info{};
  if (!GetFileInformationByHandle(file.value, &info)) fail("Cannot inspect preview");
  if (GetFileType(file.value) != FILE_TYPE_DISK ||
      (info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)))
    throw std::runtime_error("Only regular files can be previewed");
  uint64_t size = (static_cast<uint64_t>(info.nFileSizeHigh) << 32) | info.nFileSizeLow;
  if (size > 1024 * 1024) throw std::runtime_error("Preview unavailable: file exceeds 1 MiB");
  std::string bytes(1024 * 1024 + 1, '\0');
  DWORD length = 0;
  while (length < bytes.size()) {
    DWORD count = 0;
    if (!ReadFile(file.value, bytes.data() + length,
                  static_cast<DWORD>(bytes.size() - length), &count, nullptr)) fail("Cannot read preview");
    if (!count) break;
    length += count;
  }
  if (length > 1024 * 1024) throw std::runtime_error("Preview unavailable: file exceeds 1 MiB");
  bytes.resize(length);
  const uint64_t modifiedMs = (timeValue(info.ftLastWriteTime) - 116444736000000000ULL) / 10000;
  write(GetStdHandle(STD_OUTPUT_HANDLE),
         std::to_string(size) + " " + std::to_string(modifiedMs) + "\n" + bytes);
}

void listDirectory(const std::wstring& root, const std::wstring& path) {
  CheckedPath checked(root, path);
  WIN32_FIND_DATAW entry{};
  HANDLE search = FindFirstFileExW((checked.path + L"\\*").c_str(), FindExInfoBasic, &entry,
                                  FindExSearchNameMatch, nullptr, 0);
  if (search == INVALID_HANDLE_VALUE) fail("Cannot list directory");
  std::string result = "[";
  int count = 0;
  do {
    if (std::wstring(entry.cFileName) == L"." || std::wstring(entry.cFileName) == L"..") continue;
    if (count++) result += ',';
    const char* kind = entry.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT ? "symlink" :
                       entry.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY ? "directory" :
                       entry.dwFileAttributes & FILE_ATTRIBUTE_DEVICE ? "other" : "file";
    result += "{\"name\":" + json(entry.cFileName) + ",\"kind\":\"" + kind + "\"}";
    if (count == 2001) break;
  } while (FindNextFileW(search, &entry));
  const DWORD error = GetLastError();
  FindClose(search);
  if (count < 2001 && error != ERROR_NO_MORE_FILES) { SetLastError(error); fail("Cannot list directory"); }
  write(GetStdHandle(STD_OUTPUT_HANDLE), result + "]");
}

std::wstring registryPath(HKEY key, const wchar_t* subkey) {
  DWORD size = 0, type = 0;
  LSTATUS error = RegGetValueW(key, subkey, L"Path", RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ,
                              &type, nullptr, &size);
  if (error == ERROR_FILE_NOT_FOUND) return {};
  if (error != ERROR_SUCCESS || size > 65536) throw std::runtime_error("Cannot read environment PATH");
  std::vector<wchar_t> buffer(size / sizeof(wchar_t) + 1, L'\0');
  if (RegGetValueW(key, subkey, L"Path", RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ,
                  &type, buffer.data(), &size) != ERROR_SUCCESS)
    throw std::runtime_error("Cannot read environment PATH");
  return buffer.data();
}

int wmain(int argc, wchar_t** argv) {
  try {
    if (argc < 2) throw std::runtime_error("Missing operation");
    const std::wstring mode(argv[1]);
    if (mode == L"run") return runAgent(argc, argv);
    if (mode == L"identity" && argc == 3) {
      Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, number(argv[2])));
      if (!process.value) {
        if (GetLastError() == ERROR_INVALID_PARAMETER) {
          write(GetStdHandle(STD_OUTPUT_HANDLE), "null\n"); return 0;
        }
        fail("Cannot inspect process identity");
      }
      write(GetStdHandle(STD_OUTPUT_HANDLE), "{" + identity(process.value) + "}\n");
    } else if (mode == L"status" || mode == L"stop") ownedStatus(argc, argv, mode == L"stop");
    else if (mode == L"mkdir-private" && argc == 3) privateDirectory(argv[2]);
    else if (mode == L"mkdir-private-new" && argc == 3) newPrivateDirectory(argv[2]);
    else if (mode == L"create-private" && argc == 3) privateFile(argv[2]);
    else if (mode == L"write-private" && argc == 3) privateFile(argv[2], false, true);
    else if (mode == L"append-private" && argc == 3) privateFile(argv[2], true, true);
    else if (mode == L"verify-private" && argc == 3) {
      CheckedPath checked(argv[2], L"");
      verifyPrivate(checked.path);
    }
    else if (mode == L"replace" && argc == 4) atomicRename(argv[2], argv[3]);
    else if (mode == L"preview" && argc == 4) preview(argv[2], argv[3]);
    else if (mode == L"list" && argc == 4) listDirectory(argv[2], argv[3]);
    else if (mode == L"environment" && argc == 2) {
      write(GetStdHandle(STD_OUTPUT_HANDLE), "{\"user\":" +
        json(registryPath(HKEY_CURRENT_USER, L"Environment")) + ",\"machine\":" +
        json(registryPath(HKEY_LOCAL_MACHINE, L"SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment")) + "}");
    } else throw std::runtime_error("Invalid operation");
    return 0;
  } catch (const std::exception& error) {
    std::fprintf(stderr, "Code60 Windows helper: %s\n", error.what());
    return 1;
  }
}
