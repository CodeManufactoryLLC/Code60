import { z } from "zod";
import { parseValue } from "./index.js";
import { SEARCH_QUERY_LIMIT, type SearchSummarySource } from "./search-summary.js";

z.config({ jitless: true });

const identity = {
  requestId: z.string().uuid(),
  databaseEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
};
const projectSearchIdentitySchema = z.strictObject(identity);
const projectSearchQuerySchema = z.strictObject({
  ...identity,
  query: z
    .string()
    .max(SEARCH_QUERY_LIMIT)
    .refine((value) => !!value.trim(), "Enter a search query"),
  kind: z.enum(["all", "project", "run", "prompt", "message", "thought", "file"]),
  sort: z.enum(["relevance", "newest"]),
});
const projectSearchPageSchema = z.strictObject({ ...identity, cursor: z.string().uuid() });
const projectSearchOpenSchema = z.strictObject({
  ...identity,
  sourceId: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ProjectSearchIdentity = z.infer<typeof projectSearchIdentitySchema>;
export type ProjectSearchQuery = z.infer<typeof projectSearchQuerySchema>;
export type ProjectSearchPageRequest = z.infer<typeof projectSearchPageSchema>;
export type ProjectSearchOpenRequest = z.infer<typeof projectSearchOpenSchema>;
export const parseProjectSearchIdentity = (value: unknown) =>
  parseValue(projectSearchIdentitySchema, value);
export const parseProjectSearchQuery = (value: unknown) =>
  parseValue(projectSearchQuerySchema, value);
export const parseProjectSearchPage = (value: unknown) =>
  parseValue(projectSearchPageSchema, value);
export const parseProjectSearchOpen = (value: unknown) =>
  parseValue(projectSearchOpenSchema, value);

export interface SearchProject {
  id: string;
  name: string;
  path: string;
}
export interface ProjectSearchSource extends SearchSummarySource {
  project: SearchProject;
  at: string;
}
export interface ProjectSearchPage {
  requestId: string;
  results: ProjectSearchSource[];
  nextCursor: string | null;
  total: number;
  partial: boolean;
  warnings: string[];
}
export interface ProjectSearchOpened {
  projectId: string;
  databaseEpoch: number;
  source: ProjectSearchSource;
  conversation: boolean;
  /** Archived chats stay read-only and are never restored merely by opening a result. */
  archived: boolean;
}
