import { basename } from "node:path";
import {
  decodeMcpText,
  encodeMcpText,
  MCP_CONNECTOR_TEMPLATES,
  type McpBackupPreview,
  type McpBackupRequest,
  type McpManagementRead,
  type McpManagementResult,
  type McpManagementTargets,
  type McpMovePreview,
  type McpMovePreviewRequest,
  type McpMoveRequest,
  type McpResetPreview,
  type McpResetRequest,
  type McpResetSelection,
  type McpRestore,
  type McpSaveRequest,
  type McpSaveText,
  type McpTargetAddress,
  type McpTextRead,
} from "../bridge/index.js";
import { resolveMcpConnectors } from "./mcp-configuration.js";
import { McpConfigurationStore, McpStorageError } from "./mcp-configuration-store.js";

interface Project {
  projectId: string;
  databaseEpoch: number;
  root: string;
}
/** Human management only. This service supplies no definitions to execution. */
export class McpManagement {
  private store: Promise<McpConfigurationStore> | undefined;
  private closed = false;
  private registrations: Promise<unknown> = Promise.resolve();
  private readonly projectPins = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly stateRoot: string,
    private readonly userDirectory: string,
    private readonly projects: () => Project[],
  ) {}
  private storage() {
    if (this.closed) throw new McpStorageError("closed");
    if (!this.store) {
      const opening = McpConfigurationStore.open({
        stateRoot: this.stateRoot,
        userDirectory: this.userDirectory,
      });
      this.store = opening;
      void opening.catch(() => {
        if (this.store === opening) this.store = undefined;
      });
    }
    return this.store;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private changed() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        this.listeners.delete(listener);
      }
    }
  }
  targets(): Promise<McpManagementTargets> {
    const listing = this.registrations.then(() => this.listTargets());
    this.registrations = listing.catch(() => {});
    return listing;
  }
  private async listTargets(): Promise<McpManagementTargets> {
    const store = await this.storage();
    const user = store.targetIds().find((t) => t.scope === "user");
    if (!user) throw new McpStorageError("unavailable");
    const targets: McpManagementTargets["targets"] = [
      { address: { scope: "user", targetId: user.targetId }, label: "User" },
    ];
    let unavailableProjects = 0;
    const seen = new Set<string>();
    const projects = this.projects();
    const key = (project: Project) => `${project.projectId}:${project.databaseEpoch}`;
    const live = new Set(projects.map(key));
    for (const pin of this.projectPins.keys()) if (!live.has(pin)) this.projectPins.delete(pin);
    for (const project of projects) {
      try {
        const targetId = await store.registerProject(
          project.root,
          this.projectPins.get(key(project)),
        );
        this.projectPins.set(key(project), targetId);
        if (seen.has(targetId)) continue;
        seen.add(targetId);
        targets.push({
          address: {
            scope: "project",
            targetId,
            projectId: project.projectId,
            databaseEpoch: project.databaseEpoch,
          },
          label: basename(project.root),
        });
      } catch {
        unavailableProjects++;
      }
    }
    return { targets, templates: structuredClone(MCP_CONNECTOR_TEMPLATES), unavailableProjects };
  }
  private async target(address: McpTargetAddress) {
    const found = (await this.targets()).targets.find(
      (t) =>
        t.address.targetId === address.targetId &&
        t.address.scope === address.scope &&
        (address.scope === "user" ||
          (t.address.scope === "project" &&
            t.address.projectId === address.projectId &&
            t.address.databaseEpoch === address.databaseEpoch)),
    );
    if (!found) throw new McpStorageError("conflict");
    return found;
  }
  async read(address: McpTargetAddress): Promise<McpManagementRead> {
    await this.target(address);
    const store = await this.storage();
    const local = await store.read(address.targetId);
    const userId = store.targetIds().find((t) => t.scope === "user")?.targetId;
    if (!userId) throw new McpStorageError("unavailable");
    const user = address.scope === "user" ? local : await store.read(userId);
    // A malformed user file cannot be mistaken for a complete inheritance view.
    const resolved = local.document
      ? resolveMcpConnectors({
          role: address.scope === "user" ? "relay" : "project-chat",
          user: { document: user.document ?? { version: 1, servers: {} }, revision: user.revision },
          ...(address.scope === "project"
            ? {
                project: {
                  document: local.document,
                  projectId: address.targetId,
                  revision: local.revision,
                },
              }
            : {}),
        })
      : { connectors: [] };
    await this.target(address);
    return {
      target: address,
      exists: local.exists,
      revision: local.revision,
      ...(local.document ? { document: local.document } : {}),
      issues: local.issues,
      pendingRecovery: local.pendingRecovery,
      inheritanceComplete: Boolean(user.document),
      rows: resolved.connectors.map(({ status, definition }) => ({
        ...status,
        transport: definition.type,
      })),
    };
  }
  async readText(address: McpTargetAddress): Promise<McpTextRead> {
    await this.target(address);
    const value = await (await this.storage()).read(address.targetId);
    await this.target(address);
    return {
      target: address,
      exists: value.exists,
      revision: value.revision,
      contentBase64: value.text === null ? null : encodeMcpText(value.text),
      issues: value.issues,
      pendingRecovery: value.pendingRecovery,
    };
  }
  async saveText(request: McpSaveText): Promise<McpManagementResult> {
    await this.target(request.target);
    const result = await (await this.storage()).save({
      targetId: request.target.targetId,
      expectedRevision: request.expectedRevision,
      requestId: request.requestId,
      text: decodeMcpText(request.contentBase64),
      requireDecodableOriginal: true,
    });
    this.changed();
    return result;
  }
  async backups(target: McpTargetAddress) {
    await this.target(target);
    return (await this.storage()).listBackups(target.targetId);
  }
  async previewBackup(request: McpBackupRequest): Promise<McpBackupPreview> {
    await this.target(request.target);
    const value = await (await this.storage()).previewBackup(
      request.target.targetId,
      request.backupId,
    );
    await this.target(request.target);
    return {
      backupId: value.backupId,
      backupRevision: value.backupRevision,
      missing: value.missing,
      contentBase64: value.text === null ? null : encodeMcpText(value.text),
    };
  }
  async restore(request: McpRestore): Promise<McpManagementResult> {
    await this.target(request.target);
    const result = await (await this.storage()).restore({
      targetId: request.target.targetId,
      expectedRevision: request.expectedRevision,
      expectedBackupRevision: request.expectedBackupRevision,
      backupId: request.backupId,
      requestId: request.requestId,
    });
    this.changed();
    return result;
  }
  async previewReset(selection: McpResetSelection): Promise<McpResetPreview> {
    const selected = await this.target(selection.target);
    const store = await this.storage();
    const local = await store.read(selection.target.targetId);
    const list = await this.targets();
    const userTarget = list.targets.find((t) => t.address.scope === "user");
    if (!userTarget) throw new McpStorageError("unavailable");
    const user =
      selection.target.scope === "user" ? local : await store.read(userTarget.address.targetId);
    const inherited =
      selection.target.scope === "project" && !selection.includeUser ? user.document : undefined;
    return {
      configurationLabels: selection.includeUser ? ["User", selected.label] : [selected.label],
      request: {
        ...selection,
        expectedRevision: local.revision,
        ...(selection.target.scope === "project" ? { expectedUserRevision: user.revision } : {}),
      },
      removedLabels: [
        ...Object.values(local.document?.servers ?? {}),
        ...(selection.includeUser ? Object.values(user.document?.servers ?? {}) : []),
      ].map((s) => s.label),
      inheritedLabels: Object.values(inherited?.servers ?? {}).map((s) => s.label),
      remainingEnabled:
        selection.target.scope === "project" && !selection.includeUser && !user.document
          ? null
          : Object.values(inherited?.servers ?? {}).filter((s) => s.enabled).length,
      affectedProjects: list.targets
        .filter(
          (t) =>
            t.address.scope === "project" &&
            (selection.includeUser ||
              selection.target.scope === "user" ||
              t.address.targetId === selection.target.targetId),
        )
        .map((t) => t.label),
      malformed: !local.document || (selection.includeUser && !user.document),
      blocked: Boolean(
        local.pendingRecovery.length ||
          (selection.target.scope === "project" && user.pendingRecovery.length),
      ),
    };
  }
  async reset(request: McpResetRequest): Promise<McpManagementResult> {
    await this.target(request.target);
    const targets = [
      {
        targetId: request.target.targetId,
        expectedRevision: request.expectedRevision,
        reset: true,
      },
    ];
    if (request.target.scope === "project") {
      const user = (await this.targets()).targets.find((t) => t.address.scope === "user");
      if (!user || !request.expectedUserRevision) throw new McpStorageError("invalid");
      targets.push({
        targetId: user.address.targetId,
        expectedRevision: request.expectedUserRevision,
        reset: request.includeUser,
      });
    }
    const result = await (await this.storage()).reset({ targets, requestId: request.requestId });
    this.changed();
    return result;
  }
  async save(request: McpSaveRequest): Promise<McpManagementResult> {
    await this.target(request.target);
    const text = `${JSON.stringify(request.document, null, 2)}\n`;
    const result = await (await this.storage()).save({
      targetId: request.target.targetId,
      expectedRevision: request.expectedRevision,
      requestId: request.requestId,
      text,
      requireValidOriginal: true,
    });
    this.changed();
    return result;
  }
  async preview(request: McpMovePreviewRequest): Promise<McpMovePreview> {
    const source = await this.target(request.source);
    const destination = await this.target(request.destination);
    const store = await this.storage();
    const from = await store.read(source.address.targetId);
    const to = await store.read(destination.address.targetId);
    const definition = from.document?.servers[request.serverId];
    const reason =
      source.address.targetId === destination.address.targetId
        ? "Choose a different configuration."
        : from.revision !== request.expectedSourceRevision ||
            to.revision !== request.expectedDestinationRevision
          ? "Configuration changed. Reload before moving."
          : from.pendingRecovery.length || to.pendingRecovery.length
            ? "Configuration recovery is required."
            : !from.document || !to.document
              ? "Both configurations must be valid before moving."
              : !definition
                ? "The server is no longer present."
                : Object.hasOwn(to.document.servers, request.serverId)
                  ? "The destination already contains this server ID."
                  : undefined;
    const bindings =
      definition?.type === "stdio"
        ? Object.values(definition.env)
        : definition
          ? Object.values(definition.headers)
          : [];
    const affectedProjects: string[] = [];
    const userScopeAffected =
      source.address.scope === "user" || destination.address.scope === "user";
    for (const target of (await this.targets()).targets) {
      if (target.address.scope !== "project") continue;
      if (
        [source.address.targetId, destination.address.targetId].includes(target.address.targetId)
      ) {
        affectedProjects.push(target.label);
      } else if (userScopeAffected) {
        try {
          const local = await store.read(target.address.targetId);
          if (!local.document || !Object.hasOwn(local.document.servers, request.serverId))
            affectedProjects.push(target.label);
        } catch {
          affectedProjects.push(target.label);
        }
      }
    }
    return {
      allowed: !reason,
      ...(reason ? { reason } : {}),
      label: definition?.label ?? "Server",
      sourceLabel: source.label,
      destinationLabel: destination.label,
      affectedProjects: affectedProjects,
      userScopeAffected: source.address.scope === "user" || destination.address.scope === "user",
      credentialReferences:
        bindings.filter((b) => "credentialRef" in b).length +
        (definition?.type === "http" &&
        definition.auth.type === "oauth" &&
        definition.auth.clientSecretRef
          ? 1
          : 0),
    };
  }
  async move(request: McpMoveRequest): Promise<McpManagementResult> {
    await this.target(request.source);
    await this.target(request.destination);
    const result = await (await this.storage()).move({
      sourceId: request.source.targetId,
      destinationId: request.destination.targetId,
      serverId: request.serverId,
      expectedSourceRevision: request.expectedSourceRevision,
      expectedDestinationRevision: request.expectedDestinationRevision,
      requestId: request.requestId,
    });
    this.changed();
    return result;
  }
  async close() {
    this.closed = true;
    // Wait for a lazy open without turning an earlier read failure into shutdown failure.
    const store = await this.store?.catch(() => undefined);
    await store?.close();
    this.listeners.clear();
  }
}
