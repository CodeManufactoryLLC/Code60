import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  type McpAuthenticationResponse,
  type McpConnectorDefinition,
  parseMcpConnectorDocument,
} from "../bridge/index.js";
import {
  type CredentialStorePort,
  fileCode,
  type GuardedNetworkOptions,
  guardedFetch,
  lockPrivateState,
  readPrivateJson,
  writePrivateJson,
} from "../platform/index.js";
import {
  type CredentialBinding,
  CredentialFailure,
  credentialScope,
  McpCredentialVault,
  mcpSecurityFingerprint,
} from "./mcp-credentials.js";
import {
  createOAuthProof,
  discoverMcpOAuth,
  exchangeOAuthToken,
  type OAuthClient,
  type OAuthDiscovery,
  type OAuthToken,
  oauthAuthorizationUrl,
  parseStoredOAuthBundle,
  registerOAuthClient,
  revokeOAuthToken,
  verifyMetadataClient,
} from "./mcp-oauth.js";

export type OAuthCallbackPort = (input: {
  state: string;
  issuer: string;
  requireIssuer: boolean;
  signal: AbortSignal;
}) => Promise<{
  redirectUri: string;
  result: Promise<{ state: string; code?: string; issuer?: string; error?: boolean }>;
  close(): Promise<void>;
}>;
export interface McpAuthenticationPorts {
  credentials: CredentialStorePort;
  callback: OAuthCallbackPort;
  network?: (options: GuardedNetworkOptions) => typeof fetch;
}
interface AuthenticationServer {
  targetId: string;
  serverId: string;
  definition: McpConnectorDefinition;
}
export interface AuthenticationCapture extends AuthenticationServer {
  revision: string;
  validate(): Promise<unknown>;
}
interface Preview {
  page: string;
  expires: number;
  capture: AuthenticationCapture;
  fingerprint: string;
  discovery?: OAuthDiscovery;
}
interface Grant {
  id: string;
  binding: CredentialBinding;
  discovery: OAuthDiscovery;
  client: OAuthClient;
  token: OAuthToken;
  storage: "persistent" | "temporary";
  revoked: boolean;
  refresh?: Promise<void> | undefined;
}
interface Attempt {
  id: string;
  page: string;
  scope: string;
  capture: AuthenticationCapture;
  controller: AbortController;
  status: "pending" | "authenticated" | "cancelled" | "reauthorization-required";
  done: Promise<void>;
  cleanup?: (() => Promise<void>) | undefined;
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const rawRecord = z
  .unknown()
  .refine((v) => v === null || typeof v !== "object" || !Object.hasOwn(v, "__proto__"));
const indexSchema = z.strictObject({
  version: z.literal(1),
  heads: rawRecord.pipe(z.record(digest, z.uuid())),
  grants: rawRecord.pipe(
    z.record(
      z.uuid(),
      z.strictObject({
        identity: digest,
        reviewHash: digest,
        issuer: z.string().max(4096),
        grantId: z.uuid(),
        scope: digest,
        state: z.enum(["pending", "active", "refreshing", "revoked", "uncertain"]),
      }),
    ),
  ),
});
// Identity/review hashes cover public discovery and registration metadata, excluding tokens/secrets.
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = (capture: AuthenticationServer) =>
  hash([capture.targetId, capture.serverId, mcpSecurityFingerprint(capture.definition)]);
const captureFingerprint = (capture: AuthenticationCapture) =>
  hash([identity(capture), capture.revision]);
const scope = (capture: Pick<AuthenticationServer, "targetId" | "serverId">) =>
  credentialScope(capture);
function references(definition: McpConnectorDefinition) {
  const names = new Set(
    Object.values(definition.type === "stdio" ? definition.env : definition.headers).flatMap(
      (binding) => ("credentialRef" in binding ? [binding.credentialRef] : []),
    ),
  );
  const result: { reference: string; purpose: "binding" | "client-secret" }[] = [...names].map(
    (reference) => ({ reference, purpose: "binding" }),
  );
  if (
    definition.type === "http" &&
    definition.auth.type === "oauth" &&
    definition.auth.clientSecretRef
  ) {
    if (names.has(definition.auth.clientSecretRef))
      throw new Error("OAuth client secrets cannot also be transport bindings");
    result.push({ reference: definition.auth.clientSecretRef, purpose: "client-secret" });
  }
  return result;
}
function binding(
  capture: AuthenticationServer,
  reference: string,
  issuer?: string,
): CredentialBinding {
  const item = references(capture.definition).find((entry) => entry.reference === reference);
  if (!item || (item.purpose === "client-secret" && !issuer))
    throw new Error("Review the selected issuer before entering its client credential");
  return {
    ...capture,
    reference,
    account: item.purpose === "client-secret" ? `client:${issuer}` : "binding",
  };
}

/** Human authentication, registration and refresh never use the transport SDK's auth/retry hook. */
export class McpAuthentication {
  private readonly vault: McpCredentialVault;
  private readonly network: (options: GuardedNetworkOptions) => typeof fetch;
  private opening: Promise<void> | undefined;
  private release: (() => Promise<void>) | undefined;
  private previous: unknown;
  private index: z.infer<typeof indexSchema> = { version: 1, heads: {}, grants: {} };
  private queue: Promise<unknown> = Promise.resolve();
  private readonly previews = new Map<string, Preview>();
  private readonly attempts = new Map<string, Attempt>();
  private readonly cache = new Map<string, Grant>();
  private readonly setups = new Set<Promise<unknown>>();
  private readonly revoked = new Set<string>();
  private readonly detached = new Set<string>();
  private closed = false;
  private closing: Promise<void> | undefined;
  constructor(
    private readonly root: string,
    private readonly ports: McpAuthenticationPorts,
    private readonly changed: () => void,
    private readonly revokeConnections: (targetId: string, serverId: string) => Promise<void>,
  ) {
    this.vault = new McpCredentialVault(join(root, "vault"), ports.credentials, changed);
    this.network = ports.network ?? guardedFetch;
  }
  private open() {
    this.opening ??= (async () => {
      this.release = await lockPrivateState(this.root);
      try {
        this.previous = await readPrivateJson(join(this.root, "grants.json"), 1024 * 1024).catch(
          (error) => {
            if (fileCode(error) !== "ENOENT") throw error;
            return undefined;
          },
        );
        if (this.previous !== undefined) this.index = indexSchema.parse(this.previous);
        if (
          Object.entries(this.index.grants).some(([id, entry]) => id !== entry.grantId) ||
          Object.entries(this.index.heads).some(
            ([id, head]) => this.index.grants[head]?.identity !== id,
          )
        )
          throw new Error();
        for (const entry of Object.values(this.index.grants))
          if (entry.state === "refreshing" || entry.state === "pending") entry.state = "uncertain";
        await this.persist();
      } catch {
        await this.release();
        this.release = undefined;
        throw new CredentialFailure("unavailable");
      }
    })();
    return this.opening;
  }
  private async persist() {
    try {
      const published = structuredClone(this.index);
      await writePrivateJson(join(this.root, "grants.json"), published, this.previous, 1024 * 1024);
      this.previous = published;
    } catch {
      this.vault.markUncertain();
      for (const grant of this.cache.values()) grant.revoked = true;
      throw new CredentialFailure("uncertain");
    }
  }
  private serial<T>(action: () => Promise<T>, cleanup = false) {
    const result = this.queue.then(async () => {
      if (this.closed && !cleanup) throw new Error("MCP authentication is closed");
      await this.open();
      if (this.closed && !cleanup) throw new Error("MCP authentication is closed");
      return action();
    });
    this.queue = result.catch(() => {});
    return result;
  }
  private reviewed(id: string, page: string, capture: AuthenticationCapture) {
    this.assertPage(page);
    const preview = this.previews.get(id);
    if (
      !preview ||
      preview.page !== page ||
      preview.expires < Date.now() ||
      preview.fingerprint !== captureFingerprint(capture)
    )
      throw new Error("Authentication review expired or configuration changed; review again");
    return preview;
  }
  private assertPage(page: string) {
    if (this.closed || this.detached.has(page))
      throw new Error("Authentication page is detached or closed");
  }
  async preview(
    capture: AuthenticationCapture,
    page: string,
    issuer?: string,
    allowPrivateIssuer = false,
  ): Promise<McpAuthenticationResponse> {
    this.assertPage(page);
    for (const [id, preview] of this.previews)
      if (preview.expires < Date.now()) this.previews.delete(id);
    if (this.previews.size >= 256) throw new Error("Authentication review limit reached");
    await capture.validate();
    this.assertPage(page);
    let discovery: OAuthDiscovery | undefined;
    let issuers: string[] | undefined;
    if (capture.definition.type === "http" && capture.definition.auth.type === "oauth") {
      const found = await discoverMcpOAuth(
        capture.definition,
        issuer,
        allowPrivateIssuer,
        AbortSignal.timeout(30_000),
        this.network,
      );
      issuers = found.issuers;
      discovery = found.discovery;
    }
    await capture.validate();
    this.assertPage(page);
    const previewId = randomUUID();
    this.previews.set(previewId, {
      page,
      expires: Date.now() + 300_000,
      capture,
      fingerprint: captureFingerprint(capture),
      ...(discovery ? { discovery } : {}),
    });
    const result = await this.referenceStatus(capture, discovery?.issuer.issuer);
    const configured =
      capture.definition.type === "http" && capture.definition.auth.type === "oauth"
        ? capture.definition.auth
        : undefined;
    return {
      previewId,
      secureStorage: this.vault.availability(),
      fingerprint: mcpSecurityFingerprint(capture.definition),
      references: result,
      ...(issuers ? { issuers } : {}),
      ...(discovery
        ? {
            issuer: discovery.issuer.issuer,
            resource: discovery.resource,
            scopes: discovery.scopes,
            endpoints: [
              discovery.issuer.authorization_endpoint,
              discovery.issuer.token_endpoint,
              ...(discovery.issuer.registration_endpoint
                ? [discovery.issuer.registration_endpoint]
                : []),
            ],
            registration: configured?.clientId
              ? configured.clientIdType === "metadata-url"
                ? "metadata-url"
                : "user-provided"
              : discovery.issuer.registration_endpoint
                ? "per-installation"
                : "client-information-required",
          }
        : {}),
    };
  }
  private async referenceStatus(capture: AuthenticationCapture, issuer?: string) {
    return Promise.all(
      references(capture.definition).map(async (item) => ({
        ...item,
        ...(item.purpose === "client-secret" && !issuer
          ? { state: "entry-required", storage: null }
          : await this.vault.status(binding(capture, item.reference, issuer))),
      })),
    );
  }
  async status(capture: AuthenticationCapture, page: string): Promise<McpAuthenticationResponse> {
    this.assertPage(page);
    if (this.revoked.has(scope(capture)))
      return { status: "signed-out", secureStorage: this.vault.availability() };
    const active = [...this.attempts.values()].find(
      (entry) =>
        entry.page === page && entry.scope === scope(capture) && entry.status === "pending",
    );
    if (active)
      return { status: "pending", attemptId: active.id, secureStorage: this.vault.availability() };
    const prior = [...this.attempts.values()]
      .filter((entry) => entry.page === page && entry.scope === scope(capture))
      .at(-1);
    if (prior?.status === "cancelled") return { status: "cancelled" };
    const oauth = capture.definition.type === "http" && capture.definition.auth.type === "oauth";
    if (!oauth && references(capture.definition).length === 0)
      return { status: "not-required", references: [] };
    await this.open();
    const record = this.index.grants[this.index.heads[identity(capture)] ?? ""];
    const refs = await this.referenceStatus(capture, record?.issuer);
    const available =
      oauth && record?.state === "active"
        ? await this.vault.status({
            ...capture,
            reference: "$oauth-grant",
            account: `${record.issuer}:${record.grantId}`,
          })
        : undefined;
    return {
      secureStorage: this.vault.availability(),
      status: (
        oauth
          ? record?.state === "active" && available?.state === "active"
          : refs.every((item) => item.state === "active")
      )
        ? "authenticated"
        : record?.state === "uncertain"
          ? "reauthorization-required"
          : "required",
      references: refs,
    };
  }
  async write(
    capture: AuthenticationCapture,
    page: string,
    previewId: string,
    reference: string,
    secret: string,
    storage: "persistent" | "temporary",
    requestId: string,
  ) {
    const preview = this.reviewed(previewId, page, capture);
    await capture.validate();
    await this.vault.put(
      binding(capture, reference, preview.discovery?.issuer.issuer),
      secret,
      storage,
      requestId,
      async () => {
        this.assertPage(page);
        await capture.validate();
      },
    );
    await capture.validate();
    this.revoked.delete(scope(capture));
    this.changed();
    return {
      completed: true,
      references: await this.referenceStatus(capture, preview.discovery?.issuer.issuer),
    };
  }
  async forget(capture: AuthenticationCapture, page: string, previewId: string, reference: string) {
    const preview = this.reviewed(previewId, page, capture);
    binding(capture, reference, preview.discovery?.issuer.issuer);
    for (const grant of this.cache.values())
      if (credentialScope(grant.binding) === scope(capture)) grant.revoked = true;
    const cleanup = this.revokeConnections(capture.targetId, capture.serverId);
    const removal = this.vault.forget(capture, reference);
    const grants = this.serial(async () => {
      for (const entry of Object.values(this.index.grants))
        if (entry.scope === scope(capture)) entry.state = "revoked";
      await this.persist();
    });
    const tokens = this.vault.forget(capture, "$oauth-grant");
    const result = await Promise.allSettled([cleanup, removal, grants, tokens]);
    this.changed();
    if (result.some((entry) => entry.status === "rejected"))
      throw new CredentialFailure("uncertain");
    return { completed: true };
  }
  start(
    capture: AuthenticationCapture,
    page: string,
    previewId: string,
    storage: "persistent" | "temporary",
  ): Promise<McpAuthenticationResponse> {
    const result = this.performStart(capture, page, previewId, storage);
    this.setups.add(result);
    void result.finally(() => this.setups.delete(result)).catch(() => {});
    return result;
  }
  private async performStart(
    capture: AuthenticationCapture,
    page: string,
    previewId: string,
    storage: "persistent" | "temporary",
  ): Promise<McpAuthenticationResponse> {
    const preview = this.reviewed(previewId, page, capture);
    const discovery = preview.discovery;
    if (
      !discovery ||
      capture.definition.type !== "http" ||
      capture.definition.auth.type !== "oauth"
    )
      throw new Error("Review an advertised issuer and scopes before authorization");
    if (!capture.definition.auth.clientId && !discovery.issuer.registration_endpoint)
      throw new Error("User-provided OAuth client information is required");
    if ([...this.attempts.values()].filter((entry) => entry.status === "pending").length >= 32)
      throw new Error("Authentication attempt limit reached");
    if (this.attempts.size >= 4096)
      throw new Error(
        "Authentication history limit reached; restart the Gateway before more attempts",
      );
    await capture.validate();
    await this.open();
    this.assertPage(page);
    for (const prior of this.attempts.values())
      if (prior.scope === scope(capture) && prior.status === "pending") prior.controller.abort();
    const proof = createOAuthProof(),
      controller = new AbortController(),
      id = randomUUID();
    const attempt: Attempt = {
      id,
      page,
      capture,
      scope: scope(capture),
      controller,
      status: "pending",
      done: Promise.resolve(),
    };
    this.attempts.set(id, attempt);
    this.previews.delete(previewId);
    const timer = setTimeout(() => controller.abort(), 300_000);
    timer.unref();
    let callback: Awaited<ReturnType<OAuthCallbackPort>> | undefined;
    const grantId = randomUUID();
    const grantBinding: CredentialBinding = {
      ...capture,
      reference: "$oauth-grant",
      account: `${discovery.issuer.issuer}:${grantId}`,
    };
    const validate = async () => {
      this.assertPage(page);
      controller.signal.throwIfAborted();
      await capture.validate();
      controller.signal.throwIfAborted();
    };
    try {
      callback = await this.ports.callback({
        state: proof.state,
        issuer: discovery.issuer.issuer,
        requireIssuer: discovery.issuer.authorization_response_iss_parameter_supported === true,
        signal: controller.signal,
      });
      attempt.cleanup = () => callback!.close();
      await validate();
      await this.serial(async () => {
        if (Object.keys(this.index.grants).length >= 4096)
          throw new Error("OAuth grant metadata limit reached");
        this.index.grants[grantId] = {
          identity: identity(capture),
          reviewHash: hash(discovery),
          grantId,
          issuer: discovery.issuer.issuer,
          scope: scope(capture),
          state: "pending",
        };
        this.index.heads[identity(capture)] = grantId;
        await this.persist();
      });
      // Verify the selected storage before an external registration can occur.
      await this.vault.put(
        grantBinding,
        JSON.stringify({ discovery, client: null, token: null }),
        storage,
        randomUUID(),
        validate,
      );
      const definition = capture.definition;
      const registration = definition.auth;
      if (registration.type !== "oauth") throw new Error("OAuth configuration changed");
      let client: OAuthClient;
      if (registration.clientId) {
        let secret: string | undefined;
        if (registration.clientSecretRef)
          secret = (
            await this.vault.get(
              binding(capture, registration.clientSecretRef, discovery.issuer.issuer),
            )
          ).secret;
        if (registration.clientIdType === "metadata-url")
          await verifyMetadataClient(
            registration.clientId,
            callback.redirectUri,
            discovery,
            controller.signal,
            this.network,
          );
        const supported = discovery.issuer.token_endpoint_auth_methods_supported ?? [
          "client_secret_basic",
        ];
        const method = secret
          ? supported.includes("client_secret_basic")
            ? "client_secret_basic"
            : supported.includes("client_secret_post")
              ? "client_secret_post"
              : undefined
          : supported.includes("none")
            ? "none"
            : undefined;
        if (!method)
          throw new Error(
            "OAuth client authentication method is unsupported; supply compatible registration information",
          );
        client = { clientId: registration.clientId, ...(secret ? { secret } : {}), method };
      } else
        client = await registerOAuthClient(
          discovery,
          callback.redirectUri,
          controller.signal,
          this.network,
        );
      await validate();
      await this.serial(async () => {
        const record = this.index.grants[grantId];
        if (
          !record ||
          this.index.heads[identity(capture)] !== grantId ||
          record.state !== "pending"
        )
          throw new Error();
        record.reviewHash = hash([discovery, { clientId: client.clientId, method: client.method }]);
        await this.persist();
      });
      // Registration data can be sensitive even before a token exists. Store it only securely.
      await this.vault.put(
        grantBinding,
        JSON.stringify({ discovery, client, token: null }),
        storage,
        randomUUID(),
        validate,
      );
      const authorizationUrl = oauthAuthorizationUrl(
        discovery,
        client,
        callback.redirectUri,
        proof,
      );
      const listener = callback;
      attempt.done = (async () => {
        try {
          const received = await listener.result;
          await validate();
          const returnedState = Buffer.from(received.state),
            expectedState = Buffer.from(proof.state);
          if (
            returnedState.length !== expectedState.length ||
            !timingSafeEqual(returnedState, expectedState)
          )
            throw new Error();
          if (
            received.error ||
            !received.code ||
            (received.issuer !== undefined && received.issuer !== discovery.issuer.issuer) ||
            (discovery.issuer.authorization_response_iss_parameter_supported && !received.issuer)
          )
            throw new Error();
          await capture.validate();
          const token = await exchangeOAuthToken(
            discovery,
            client,
            {
              grant_type: "authorization_code",
              code: received.code,
              redirect_uri: listener.redirectUri,
              code_verifier: proof.verifier,
            },
            controller.signal,
            undefined,
            this.network,
          );
          await capture.validate();
          controller.signal.throwIfAborted();
          await this.vault.put(
            grantBinding,
            JSON.stringify({ discovery, client, token }),
            storage,
            randomUUID(),
            validate,
          );
          await capture.validate();
          controller.signal.throwIfAborted();
          await listener.close();
          attempt.cleanup = undefined;
          await validate();
          await this.serial(async () => {
            const record = this.index.grants[this.index.heads[identity(capture)] ?? ""];
            if (record?.grantId !== grantId || record.state !== "pending") throw new Error();
            record.state = "active";
            await this.persist();
          });
          await validate();
          this.cache.set(grantId, {
            id: grantId,
            binding: grantBinding,
            discovery,
            client,
            token,
            storage,
            revoked: false,
          });
          this.revoked.delete(scope(capture));
          attempt.status = "authenticated";
        } catch {
          attempt.status = controller.signal.aborted ? "cancelled" : "reauthorization-required";
          await this.serial(async () => {
            const record = this.index.grants[grantId];
            if (record && record.state !== "revoked") {
              record.state = "uncertain";
              await this.persist();
            }
          }, true).catch(() => {});
        } finally {
          clearTimeout(timer);
          await listener.close();
          attempt.cleanup = undefined;
          this.changed();
        }
      })();
      void attempt.done.catch(() => {
        attempt.status = "reauthorization-required";
        this.changed();
      });
      this.changed();
      return { attemptId: id, authorizationUrl, status: "pending", storage };
    } catch (error) {
      clearTimeout(timer);
      controller.abort();
      attempt.status = "reauthorization-required";
      await this.serial(async () => {
        const record = this.index.grants[grantId];
        if (record?.state === "pending") {
          record.state = "uncertain";
          await this.persist();
        }
      }, true).catch(() => {});
      await callback?.close();
      attempt.cleanup = undefined;
      this.changed();
      if (error instanceof CredentialFailure) throw error;
      throw new Error(
        "Authorization could not start; review registration and secure storage. No temporary fallback or automatic retry occurred",
      );
    }
  }
  cancel(page: string, id: string) {
    const attempt = this.attempts.get(id);
    if (attempt?.page === page) {
      attempt.status = "cancelled";
      attempt.controller.abort();
      this.changed();
    }
  }
  detach(page: string) {
    this.detached.add(page);
    for (const [id, preview] of this.previews) if (preview.page === page) this.previews.delete(id);
    for (const attempt of this.attempts.values())
      if (attempt.page === page && attempt.status === "pending") this.cancel(page, attempt.id);
  }
  invalidateOwners() {
    for (const attempt of this.attempts.values())
      if (attempt.status === "pending") attempt.controller.abort();
    this.previews.clear();
  }
  recheckOwners() {
    for (const [id, preview] of this.previews)
      void preview.capture.validate().catch(() => this.previews.delete(id));
    for (const attempt of this.attempts.values())
      if (attempt.status === "pending")
        void attempt.capture.validate().catch(() => attempt.controller.abort());
  }
  async signOut(capture: Pick<AuthenticationServer, "targetId" | "serverId">) {
    this.revoked.add(scope(capture));
    for (const grant of this.cache.values())
      if (credentialScope(grant.binding) === scope(capture)) grant.revoked = true;
    for (const attempt of this.attempts.values())
      if (attempt.scope === scope(capture) && attempt.status === "pending")
        attempt.controller.abort();
    const cleanup = this.revokeConnections(capture.targetId, capture.serverId);
    const deletion = this.vault.forget(capture);
    const metadata = this.serial(async () => {
      for (const record of Object.values(this.index.grants))
        if (record.scope === scope(capture)) record.state = "revoked";
      await this.persist();
    });
    const result = await Promise.allSettled([cleanup, deletion, metadata]);
    const grants = [...this.cache.entries()].filter(
      ([, grant]) => credentialScope(grant.binding) === scope(capture),
    );
    await Promise.allSettled(grants.map(([, grant]) => grant.refresh));
    const remote: ("complete" | "not-advertised" | "uncertain")[] = [];
    const deadline = AbortSignal.timeout(10_000);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, grants.length) }, async () => {
        for (;;) {
          const item = grants[next++];
          if (!item) return;
          remote.push(await revokeOAuthToken(item[1], deadline, this.network));
        }
      }),
    );
    for (const [id, grant] of grants) {
      grant.token.accessToken = "";
      delete grant.token.refreshToken;
      delete grant.client.secret;
      this.cache.delete(id);
    }
    this.changed();
    const unobserved =
      grants.length === 0 &&
      Object.values(this.index.grants).some((entry) => entry.scope === scope(capture));
    const remoteRevocation =
      remote.includes("uncertain") || unobserved
        ? ("uncertain" as const)
        : remote.includes("complete")
          ? ("complete" as const)
          : ("not-advertised" as const);
    if (result.some((entry) => entry.status === "rejected"))
      return { status: "deletion-uncertain" as const, completed: false, remoteRevocation };
    return { status: "signed-out" as const, completed: true, remoteRevocation };
  }
  private async grant(capture: AuthenticationServer, signal: AbortSignal): Promise<Grant> {
    await this.open();
    const record = this.index.grants[this.index.heads[identity(capture)] ?? ""];
    if (this.revoked.has(scope(capture)) || !record) throw new CredentialFailure("required");
    const cached = this.cache.get(record.grantId);
    if (
      cached &&
      !cached.revoked &&
      (record.state === "active" || (record.state === "refreshing" && cached.refresh))
    )
      return cached;
    if (record.state !== "active" || cached?.revoked) throw new CredentialFailure("required");
    const grantBinding: CredentialBinding = {
      ...capture,
      reference: "$oauth-grant",
      account: `${record.issuer}:${record.grantId}`,
    };
    const stored = await this.vault.get(grantBinding, signal);
    // Secure reads may overlap after restart. Never replace a winning grant/refresh
    // with another object, or fall back after a new head/sign-out wins the await.
    if (
      this.closed ||
      this.revoked.has(scope(capture)) ||
      this.index.heads[identity(capture)] !== record.grantId
    )
      throw new CredentialFailure("required");
    const winner = this.cache.get(record.grantId);
    if (
      winner &&
      !winner.revoked &&
      (record.state === "active" || (record.state === "refreshing" && winner.refresh))
    )
      return winner;
    if (record.state !== "active" || winner?.revoked) throw new CredentialFailure("required");
    let blob: ReturnType<typeof parseStoredOAuthBundle>;
    try {
      blob = parseStoredOAuthBundle(JSON.parse(stored.secret));
    } catch {
      throw new CredentialFailure("required");
    }
    if (
      hash([blob.discovery, { clientId: blob.client.clientId, method: blob.client.method }]) !==
        record.reviewHash ||
      blob.discovery.issuer.issuer !== record.issuer ||
      blob.token.scopes.some((v) => !blob.discovery.scopes.includes(v))
    )
      throw new CredentialFailure("required");
    const grant: Grant = {
      id: record.grantId,
      binding: grantBinding,
      ...blob,
      storage: stored.storage,
      revoked: false,
    };
    this.cache.set(record.grantId, grant);
    return grant;
  }
  private async fresh(grant: Grant, signal: AbortSignal) {
    if (grant.revoked || this.closed) throw new CredentialFailure("required");
    if (grant.token.expiresAt === null || grant.token.expiresAt > Date.now() + 30_000) return;
    if (!grant.token.refreshToken) {
      grant.revoked = true;
      throw new CredentialFailure("required");
    }
    if (!grant.refresh) {
      const flight = (async () => {
        await this.serial(async () => {
          const record = this.index.grants[grant.id];
          if (!record || record.state !== "active") throw new CredentialFailure("required");
          record.state = "refreshing";
          await this.persist();
        });
        try {
          const token = await exchangeOAuthToken(
            grant.discovery,
            grant.client,
            { grant_type: "refresh_token", refresh_token: grant.token.refreshToken! },
            AbortSignal.timeout(10_000),
            grant.token,
            this.network,
          );
          if (grant.revoked || this.closed) throw new CredentialFailure("required");
          await this.vault.put(
            grant.binding,
            JSON.stringify({ discovery: grant.discovery, client: grant.client, token }),
            grant.storage,
            randomUUID(),
          );
          if (grant.revoked || this.closed) throw new CredentialFailure("required");
          grant.token = token;
          await this.serial(async () => {
            const record = this.index.grants[grant.id];
            if (!record || record.state !== "refreshing") throw new CredentialFailure("required");
            record.state = "active";
            await this.persist();
          });
        } catch {
          grant.revoked = true;
          await this.serial(async () => {
            const record = this.index.grants[grant.id];
            if (record && record.state !== "revoked") {
              record.state = "uncertain";
              await this.persist();
            }
          }, true).catch(() => {});
          await this.revokeConnections(grant.binding.targetId, grant.binding.serverId);
          throw new Error(
            "OAuth refresh outcome is uncertain; explicit reauthorization is required and no tool call was replayed",
          );
        }
      })();
      grant.refresh = flight;
      void flight
        .finally(() => {
          if (grant.refresh === flight) grant.refresh = undefined;
        })
        .catch(() => {});
    }
    let abort: (() => void) | undefined;
    try {
      await Promise.race([
        grant.refresh,
        new Promise<never>((_, reject) => {
          abort = () => reject(new Error("Authentication wait cancelled"));
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        }),
      ]);
      signal.throwIfAborted();
      if (grant.revoked) throw new CredentialFailure("required");
    } finally {
      if (abort) signal.removeEventListener("abort", abort);
    }
  }
  async prepare(capture: AuthenticationServer, signal: AbortSignal) {
    parseMcpConnectorDocument({ version: 1, servers: { [capture.serverId]: capture.definition } });
    const needsCredentials =
      references(capture.definition).length > 0 ||
      (capture.definition.type === "http" && capture.definition.auth.type === "oauth");
    if (this.closed || (needsCredentials && this.revoked.has(scope(capture))))
      throw new CredentialFailure("required");
    const environment: Record<string, string> = Object.create(null),
      headers: Record<string, string> = Object.create(null);
    const definition = capture.definition;
    for (const [name, item] of Object.entries(
      definition.type === "stdio" ? definition.env : definition.headers,
    )) {
      signal.throwIfAborted();
      let secret =
        "value" in item
          ? item.value
          : (await this.vault.get(binding(capture, item.credentialRef), signal)).secret;
      if ("credentialRef" in item && "prefix" in item) secret = `${item.prefix ?? ""}${secret}`;
      if (
        secret.includes("\0") ||
        (definition.type === "http" && (/[\r\n]/.test(secret) || Buffer.byteLength(secret) > 8192))
      )
        throw new Error("Credential binding value rejected");
      if (definition.type === "stdio") environment[name] = secret;
      else headers[name] = secret;
    }
    const oauth =
      definition.type === "http" && definition.auth.type === "oauth"
        ? await this.grant(capture, signal)
        : undefined;
    if (oauth && Object.keys(headers).some((name) => name.toLowerCase() === "authorization"))
      throw new Error("OAuth and Authorization bindings conflict");
    const beforeCall = async (callSignal: AbortSignal) => {
      if (oauth) await this.fresh(oauth, callSignal);
      callSignal.throwIfAborted();
      if (needsCredentials && this.revoked.has(scope(capture)))
        throw new CredentialFailure("required");
    };
    await beforeCall(signal);
    const network =
      definition.type === "http"
        ? this.network({
            privateOrigins: [new URL(definition.url).origin],
            maximumBytes: 8 * 1024 * 1024,
            streaming: true,
            timeoutMs: 0,
            credentials: references(definition).length > 0 || Boolean(oauth),
          })
        : undefined;
    const fetchWithToken: typeof fetch | undefined =
      network &&
      (async (input, init) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        const method = init?.method ?? "GET";
        const cleanup =
          method === "DELETE" ||
          (typeof init?.body === "string" &&
            JSON.parse(init.body).method === "notifications/cancelled");
        if (
          definition.type !== "http" ||
          url.origin !== new URL(definition.url).origin ||
          url.pathname !== new URL(definition.url).pathname ||
          (oauth?.revoked && !cleanup)
        )
          throw new Error("MCP credential destination rejected");
        const outgoing = new Headers(init?.headers);
        if (oauth) outgoing.set("Authorization", `Bearer ${oauth.token.accessToken}`);
        return network(input, { ...init, headers: outgoing });
      });
    return {
      environment,
      headers,
      ...(fetchWithToken ? { fetch: fetchWithToken } : {}),
      beforeCall,
    };
  }
  beginShutdown() {
    this.closed = true;
    this.invalidateOwners();
    for (const grant of this.cache.values()) grant.revoked = true;
  }
  close(): Promise<void> {
    this.closing ??= this.finishClose();
    void this.closing.catch(() => {
      this.closing = undefined;
    });
    return this.closing;
  }
  private async finishClose() {
    this.beginShutdown();
    await Promise.allSettled([...this.setups]);
    await Promise.allSettled([...this.attempts.values()].map((attempt) => attempt.done));
    await Promise.allSettled([...this.cache.values()].map((grant) => grant.refresh));
    const cleanup = await Promise.allSettled(
      [...this.attempts.values()].flatMap((attempt) =>
        attempt.cleanup ? [attempt.cleanup()] : [],
      ),
    );
    await this.queue;
    if (cleanup.some((result) => result.status === "rejected"))
      throw new Error("OAuth callback cleanup remains unresolved");
    await this.vault.close();
    await this.opening;
    await this.release?.();
    this.release = undefined;
    for (const grant of this.cache.values()) {
      grant.token.accessToken = "";
      delete grant.token.refreshToken;
      delete grant.client.secret;
    }
    this.cache.clear();
  }
}
