import { z } from "zod";
import type { GitReadiness } from "../core/index.js";
import { pairedProjectIdentity, projectRequestFields } from "./project-identity.js";

export type { GitReadiness } from "../core/index.js";

const project = z.string().min(1).max(4096);
const identity = { project, sessionId: z.string().uuid(), ...projectRequestFields };
const gitProjectSchema = z
  .strictObject({ project, ...projectRequestFields })
  .refine(pairedProjectIdentity);
const gitSetupIdentitySchema = z.strictObject(identity).refine(pairedProjectIdentity);
const gitSetupFileSchema = z
  .strictObject({ ...identity, fileId: z.string().uuid() })
  .refine(pairedProjectIdentity);
const gitSetupCommitSchema = z
  .strictObject({
    ...identity,
    fileIds: z.array(z.string().uuid()).max(10_000),
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n\0<>]/.test(s)),
    email: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((s) => !/[\r\n\0<>]/.test(s)),
  })
  .refine(pairedProjectIdentity);
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value, { jitless: true });
  if (!result.success) throw new Error("Invalid Git setup request");
  return result.data;
};
export const parseGitProject = (value: unknown) => parse(gitProjectSchema, value);
export const parseGitSetupIdentity = (value: unknown) => parse(gitSetupIdentitySchema, value);
export const parseGitSetupFile = (value: unknown) => parse(gitSetupFileSchema, value);
export const parseGitSetupCommit = (value: unknown) => parse(gitSetupCommitSchema, value);
export type GitProject = z.infer<typeof gitProjectSchema>;
export type GitSetupIdentity = z.infer<typeof gitSetupIdentitySchema>;
export type GitSetupFileRequest = z.infer<typeof gitSetupFileSchema>;
export type GitSetupCommit = z.infer<typeof gitSetupCommitSchema>;
export interface GitSetupSession {
  sessionId: string;
  project: string;
  readiness: GitReadiness;
  files: { id: string; path: string; size: number }[];
  excluded: string[];
  author: { name: string; email: string };
}
export interface GitSetupOutcome {
  readiness: GitReadiness;
  error?: string;
}
