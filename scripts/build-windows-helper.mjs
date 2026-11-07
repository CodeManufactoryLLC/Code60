import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const arch = process.env.CODE60_HELPER_ARCH || process.arch;
  if (!["x64", "arm64"].includes(arch)) throw new Error("The Windows helper requires x64 or ARM64");
  const vswhere = join(
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Microsoft Visual Studio/Installer/vswhere.exe",
  );
  const found = spawnSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-property",
      "installationPath",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 10_000 },
  );
  const installation = found.stdout?.trim();
  if (found.status !== 0 || !installation)
    throw new Error("Install Microsoft C++ Build Tools and the Windows 11 SDK to build the helper");
  const newest = async (path) =>
    (await readdir(path)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  const tools = join(installation, "VC/Tools/MSVC");
  const compiler = join(tools, await newest(tools));
  const sdk = join(
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    "Windows Kits/10",
  );
  const sdkVersion = await newest(join(sdk, "Include"));
  const host = process.arch === "arm64" ? "Hostarm64" : "Hostx64";
  const executable = join(compiler, "bin", host, arch, "cl.exe");
  if (!existsSync(executable)) throw new Error(`Install the MSVC ${arch} compiler`);
  const output = join(root, "native/win32", arch);
  await mkdir(output, { recursive: true });
  const result = spawnSync(
    executable,
    [
      "/nologo",
      "/std:c++20",
      "/EHsc",
      "/W4",
      "/WX",
      "/utf-8",
      "/O2",
      "/MT",
      "/guard:cf",
      "/DUNICODE",
      "/D_UNICODE",
      "/D_WIN32_WINNT=0x0A00",
      `/I${join(compiler, "include")}`,
      ...["ucrt", "shared", "um"].map((name) => `/I${join(sdk, "Include", sdkVersion, name)}`),
      join(root, "native/windows/code60-host.cpp"),
      `/Fo${join(output, "code60-host.obj")}`,
      `/Fe${join(output, "code60-host.exe")}`,
      "/link",
      "/DYNAMICBASE",
      "/NXCOMPAT",
      "/guard:cf",
      `/LIBPATH:${join(compiler, "lib", arch)}`,
      ...["ucrt", "um"].map((name) => `/LIBPATH:${join(sdk, "Lib", sdkVersion, name, arch)}`),
      "advapi32.lib",
    ],
    { cwd: root, stdio: "inherit", windowsHide: true, timeout: 120_000 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
