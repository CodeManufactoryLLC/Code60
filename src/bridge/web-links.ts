import { z } from "zod";
import { parseValue } from "../contracts/index.js";

z.config({ jitless: true });

const webUrl = z
  .string()
  .max(8_192)
  .transform((value, ctx) => {
    try {
      if (
        !/^https?:\/\/[^/?#]/i.test(value) ||
        /\s/u.test(value) ||
        value.includes("\\") ||
        [...value].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new Error();
      const url = new URL(value);
      if (!url.hostname || url.username || url.password || url.href.length > 8_192)
        throw new Error();
      return url.href;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Use an absolute HTTP or HTTPS URL without credentials",
      });
      return z.NEVER;
    }
  });

const webLinkSchema = z.strictObject({ url: webUrl });
export type WebLink = z.input<typeof webLinkSchema>;

/** Validate again in main before showing or opening an untrusted chat destination. */
export const parseWebLink = (value: unknown) => parseValue(webLinkSchema, value);
