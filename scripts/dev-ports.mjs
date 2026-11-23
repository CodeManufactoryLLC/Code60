/** Optional development-only ports; absent values preserve ephemeral defaults. */
export function developmentPort(value, name) {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535)
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  return Number(value);
}
