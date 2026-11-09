// An explicit dispatch choice, never a fallback for missing signing credentials.
function unsignedWindowsBeta(version, env = process.env) {
  const value = env.CODE60_UNSIGNED_WINDOWS_BETA;
  if (value === undefined || value === "0") return false;
  if (value !== "1" || !/^\d+\.\d+\.\d+-beta\.\d+(?:\+[\da-zA-Z.-]+)?$/.test(version))
    throw new Error("Unsigned Windows installers require an explicit beta version and opt-in");
  return true;
}
module.exports = { unsignedWindowsBeta };
