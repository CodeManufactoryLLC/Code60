import { z } from "zod";

export interface ProjectRequestIdentity {
  projectId?: string | undefined;
  databaseEpoch?: number | undefined;
}

export const projectRequestFields = {
  projectId: z.string().uuid().optional(),
  databaseEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
};

export const pairedProjectIdentity = (value: ProjectRequestIdentity): boolean =>
  (value.projectId === undefined) === (value.databaseEpoch === undefined);
