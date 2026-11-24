import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { McpConnectorDefinition } from "../bridge/index.js";
import { type GuardedNetworkOptions, guardedFetch } from "../platform/index.js";

const value = z
  .string()
  .min(1)
  .max(4096)
  .refine((s) => !/[\0\r\n]/.test(s));
const scopeValue = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\x21\x23-\x5b\x5d-\x7e]+$/);
const scopes = z.array(scopeValue).max(64);
const resourceSchema = z.object({
  resource: value,
  authorization_servers: z.array(value).min(1).max(16),
  scopes_supported: scopes.optional(),
});
const issuerSchema = z.object({
  issuer: value,
  authorization_endpoint: value,
  token_endpoint: value,
  registration_endpoint: value.optional(),
  revocation_endpoint: value.optional(),
  code_challenge_methods_supported: z.array(z.string()).max(16),
  grant_types_supported: z.array(z.string()).max(32).optional(),
  response_types_supported: z.array(z.string()).max(32).optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).max(16).optional(),
  authorization_response_iss_parameter_supported: z.boolean().optional(),
  client_id_metadata_document_supported: z.boolean().optional(),
});
type OAuthIssuer = z.infer<typeof issuerSchema>;
export interface OAuthDiscovery {
  issuer: OAuthIssuer;
  resource: string;
  scopes: string[];
  privateOrigins: string[];
}
function safeUrl(input: string) {
  try {
    const url = new URL(input);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      input.length > 4096
    )
      throw new Error();
    return url;
  } catch {
    throw new Error("OAuth endpoint rejected");
  }
}
function issuerEndpoint(input: string) {
  const url = safeUrl(input);
  const host = url.hostname;
  if (
    url.protocol !== "https:" &&
    host !== "localhost" &&
    host !== "[::1]" &&
    !/^127\.\d+\.\d+\.\d+$/.test(host)
  )
    throw new Error("OAuth requires HTTPS except loopback");
  return url;
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error("OAuth metadata or response is invalid");
  return result.data;
}
async function responseJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(await response.arrayBuffer()),
    );
  } catch {
    throw new Error("OAuth metadata or response is invalid");
  }
}
/** Recognize only Bearer challenge parameters; never return an untrusted error description. */
export function bearerChallenge(source: string | null) {
  if (!source || source.length > 8192) return {};
  const parts: string[] = [];
  let start = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ",") {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quoted || escaped) throw new Error("OAuth challenge is invalid");
  parts.push(source.slice(start).trim());
  const values: Record<string, string> = Object.create(null);
  let bearer = false;
  const pattern = /^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))\s*$/;
  for (let part of parts) {
    const scheme = /^([A-Za-z][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(part);
    if (scheme) {
      if (bearer) break;
      bearer = scheme[1]!.toLowerCase() === "bearer";
      part = scheme[2] ?? "";
      if (!part) continue;
    }
    if (!bearer) continue;
    const parameter = pattern.exec(part);
    if (!parameter) throw new Error("OAuth challenge is invalid");
    const key = parameter[1]!.toLowerCase();
    if (Object.hasOwn(values, key)) throw new Error("OAuth challenge is ambiguous");
    values[key] = (parameter[2] ?? parameter[3] ?? "").replace(/\\(.)/g, "$1");
  }
  return {
    ...(values.resource_metadata ? { metadata: values.resource_metadata } : {}),
    ...(values.scope ? { scopes: parse(scopes, values.scope.split(" ").filter(Boolean)) } : {}),
  };
}
export async function discoverMcpOAuth(
  definition: Extract<McpConnectorDefinition, { type: "http" }>,
  selectedIssuer: string | undefined,
  allowPrivateIssuer: boolean,
  signal: AbortSignal,
  network: (options: GuardedNetworkOptions) => typeof fetch = guardedFetch,
): Promise<{ issuers: string[]; discovery?: OAuthDiscovery }> {
  if (definition.auth.type !== "oauth") throw new Error("OAuth is not configured");
  const endpoint = safeUrl(definition.url);
  const privateOrigins = [endpoint.origin];
  const request = network({ privateOrigins, redirects: 3, timeoutMs: 10_000 });
  const probe = await request(endpoint, { signal, headers: { Accept: "application/json" } });
  const challenge = bearerChallenge(probe.headers.get("www-authenticate"));
  await probe.body?.cancel();
  const paths = challenge.metadata
    ? [challenge.metadata]
    : [
        new URL(
          `/.well-known/oauth-protected-resource${endpoint.pathname === "/" ? "" : endpoint.pathname}`,
          endpoint.origin,
        ).href,
        new URL("/.well-known/oauth-protected-resource", endpoint.origin).href,
      ];
  let resource: z.infer<typeof resourceSchema> | undefined;
  for (const path of [...new Set(paths)]) {
    safeUrl(path);
    const response = await request(path, { signal });
    if (response.status === 404) {
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw new Error("Protected resource discovery failed");
    resource = parse(resourceSchema, await responseJson(response));
    break;
  }
  if (!resource) throw new Error("Protected resource metadata is unavailable");
  const resourceUrl = safeUrl(resource.resource);
  if (
    resourceUrl.search ||
    resourceUrl.origin !== endpoint.origin ||
    !(
      endpoint.pathname === resourceUrl.pathname ||
      endpoint.pathname.startsWith(`${resourceUrl.pathname.replace(/\/$/, "")}/`)
    )
  )
    throw new Error("OAuth resource binding rejected");
  const issuers = [...new Set(resource.authorization_servers)];
  for (const issuer of issuers) {
    const url = issuerEndpoint(issuer);
    if (url.search) throw new Error("OAuth issuer rejected");
  }
  if (!selectedIssuer) return { issuers };
  const selected = selectedIssuer ?? issuers[0]!;
  if (!issuers.includes(selected)) throw new Error("Select an advertised OAuth issuer");
  const issuerUrl = safeUrl(selected);
  if (allowPrivateIssuer) privateOrigins.push(issuerUrl.origin);
  const issuerRequest = network({ privateOrigins, redirects: 3, timeoutMs: 10_000 });
  const path = issuerUrl.pathname === "/" ? "" : issuerUrl.pathname;
  const candidates = path
    ? [
        `${issuerUrl.origin}/.well-known/oauth-authorization-server${path}`,
        `${issuerUrl.origin}/.well-known/openid-configuration${path}`,
        `${selected.replace(/\/$/, "")}/.well-known/openid-configuration`,
      ]
    : [
        `${issuerUrl.origin}/.well-known/oauth-authorization-server`,
        `${issuerUrl.origin}/.well-known/openid-configuration`,
      ];
  let issuer: OAuthIssuer | undefined;
  for (const url of candidates) {
    const response = await issuerRequest(url, { signal });
    if (response.status === 404) {
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) throw new Error("Authorization server discovery failed");
    issuer = parse(issuerSchema, await responseJson(response));
    break;
  }
  if (
    !issuer ||
    issuer.issuer !== selected ||
    !issuer.code_challenge_methods_supported.includes("S256") ||
    (issuer.response_types_supported && !issuer.response_types_supported.includes("code")) ||
    (issuer.grant_types_supported && !issuer.grant_types_supported.includes("authorization_code"))
  )
    throw new Error("OAuth issuer or PKCE support rejected");
  for (const url of [
    issuer.authorization_endpoint,
    issuer.token_endpoint,
    issuer.registration_endpoint,
    issuer.revocation_endpoint,
  ])
    if (url) issuerEndpoint(url);
  const requested = [
    ...new Set([
      ...definition.auth.scopes,
      ...(challenge.scopes ??
        (definition.auth.scopes.length ? [] : (resource.scopes_supported ?? []))),
    ]),
  ];
  parse(scopes, requested);
  return {
    issuers,
    discovery: {
      issuer,
      resource: resource.resource,
      scopes: requested,
      privateOrigins: [...new Set(privateOrigins)],
    },
  };
}
export function createOAuthProof() {
  const verifier = randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  };
}
export interface OAuthClient {
  clientId: string;
  secret?: string | undefined;
  method: "none" | "client_secret_basic" | "client_secret_post";
}
export function oauthAuthorizationUrl(
  discovery: OAuthDiscovery,
  client: OAuthClient,
  redirectUri: string,
  proof: ReturnType<typeof createOAuthProof>,
) {
  const url = issuerEndpoint(discovery.issuer.authorization_endpoint);
  for (const key of [
    "client_id",
    "redirect_uri",
    "response_type",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
    "resource",
  ])
    if (url.searchParams.has(key)) throw new Error("OAuth endpoint has conflicting parameters");
  const query = {
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: redirectUri,
    ...(discovery.scopes.length ? { scope: discovery.scopes.join(" ") } : {}),
    state: proof.state,
    code_challenge: proof.challenge,
    code_challenge_method: "S256",
    resource: discovery.resource,
  };
  for (const [key, val] of Object.entries(query)) url.searchParams.set(key, val);
  return url.href;
}
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt: number | null;
  scopes: string[];
}
const tokenSchema = z.object({
  access_token: z
    .string()
    .min(1)
    .max(65536)
    .regex(/^[A-Za-z0-9\-._~+/]+=*$/),
  token_type: z.string(),
  refresh_token: z
    .string()
    .min(1)
    .max(65536)
    .refine((v) => !/[\0\r\n]/.test(v))
    .optional(),
  expires_in: z
    .number()
    .int()
    .nonnegative()
    .max(366 * 24 * 60 * 60)
    .optional(),
  scope: z.string().max(16384).optional(),
});
export async function exchangeOAuthToken(
  discovery: OAuthDiscovery,
  client: OAuthClient,
  parameters: Record<string, string>,
  signal: AbortSignal,
  previous?: OAuthToken,
  network: (options: GuardedNetworkOptions) => typeof fetch = guardedFetch,
): Promise<OAuthToken> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  const body = new URLSearchParams({ ...parameters, resource: discovery.resource });
  if (client.method === "client_secret_basic") {
    if (!client.secret) throw new Error("OAuth client credential required");
    const encode = (v: string) => new URLSearchParams({ v }).toString().slice(2);
    headers.Authorization = `Basic ${Buffer.from(`${encode(client.clientId)}:${encode(client.secret)}`).toString("base64")}`;
  } else {
    body.set("client_id", client.clientId);
    if (client.method === "client_secret_post") {
      if (!client.secret) throw new Error("OAuth client credential required");
      body.set("client_secret", client.secret);
    }
  }
  const request = network({
    privateOrigins: discovery.privateOrigins,
    timeoutMs: 10_000,
    credentials: true,
  });
  const response = await request(discovery.issuer.token_endpoint, {
    method: "POST",
    headers,
    body: body.toString(),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("OAuth exchange failed or is uncertain; explicit authorization is required");
  }
  const token = parse(tokenSchema, await responseJson(response));
  const granted =
    token.scope === undefined
      ? (previous?.scopes ?? discovery.scopes)
      : parse(scopes, token.scope.split(" ").filter(Boolean));
  if (
    token.token_type.toLowerCase() !== "bearer" ||
    granted.some((scope) => !discovery.scopes.includes(scope)) ||
    (previous && granted.some((scope) => !previous.scopes.includes(scope)))
  )
    throw new Error("OAuth token binding or scope escalation rejected");
  return {
    accessToken: token.access_token,
    ...(token.refresh_token || previous?.refreshToken
      ? { refreshToken: token.refresh_token ?? previous!.refreshToken! }
      : {}),
    expiresAt: token.expires_in === undefined ? null : Date.now() + token.expires_in * 1000,
    scopes: granted,
  };
}
export async function registerOAuthClient(
  discovery: OAuthDiscovery,
  redirectUri: string,
  signal: AbortSignal,
  network: (options: GuardedNetworkOptions) => typeof fetch = guardedFetch,
): Promise<OAuthClient> {
  const endpoint = discovery.issuer.registration_endpoint;
  if (!endpoint) throw new Error("User-provided OAuth client information is required");
  const response = await network({
    privateOrigins: discovery.privateOrigins,
    timeoutMs: 10_000,
    credentials: true,
  })(endpoint, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Code60 (this installation)",
      application_type: "native",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("OAuth registration failed or is uncertain; do not retry automatically");
  }
  const registration = parse(
    z.object({
      client_id: value,
      client_secret: z.string().max(65536).optional(),
      token_endpoint_auth_method: z
        .enum(["none", "client_secret_basic", "client_secret_post"])
        .default("none"),
      redirect_uris: z.array(value).max(16).optional(),
    }),
    await responseJson(response),
  );
  if (registration.redirect_uris && !registration.redirect_uris.includes(redirectUri))
    throw new Error("OAuth registration redirect binding rejected");
  if (registration.token_endpoint_auth_method !== "none" && !registration.client_secret)
    throw new Error("OAuth registration authentication rejected");
  return {
    clientId: registration.client_id,
    ...(registration.client_secret ? { secret: registration.client_secret } : {}),
    method: registration.token_endpoint_auth_method,
  };
}
export async function verifyMetadataClient(
  clientId: string,
  redirectUri: string,
  discovery: OAuthDiscovery,
  signal: AbortSignal,
  network: (options: GuardedNetworkOptions) => typeof fetch = guardedFetch,
) {
  const url = safeUrl(clientId);
  if (
    !discovery.issuer.client_id_metadata_document_supported ||
    url.protocol !== "https:" ||
    url.pathname === "/"
  )
    throw new Error("OAuth metadata client ID is unsupported");
  const response = await network({
    privateOrigins: discovery.privateOrigins,
    redirects: 3,
    timeoutMs: 10_000,
  })(url, { signal });
  if (!response.ok) throw new Error("OAuth client metadata unavailable");
  const metadata = parse(
    z.object({
      client_id: value,
      client_name: value,
      redirect_uris: z.array(value).min(1).max(16),
      token_endpoint_auth_method: z.literal("none").default("none"),
    }),
    await responseJson(response),
  );
  const redirect = new URL(redirectUri);
  if (
    metadata.client_id !== clientId ||
    !metadata.redirect_uris.some((candidate) => {
      const registered = safeUrl(candidate);
      return (
        registered.protocol === redirect.protocol &&
        registered.hostname === redirect.hostname &&
        registered.pathname === redirect.pathname &&
        registered.search === redirect.search &&
        (registered.port === redirect.port || ["127.0.0.1", "[::1]"].includes(redirect.hostname))
      );
    })
  )
    throw new Error("OAuth metadata client redirect binding rejected");
}

const discoverySchema = z.strictObject({
  issuer: issuerSchema,
  resource: value,
  scopes,
  privateOrigins: z
    .array(value)
    .max(32)
    .refine((items) => items.every((item) => safeUrl(item).origin === item)),
});
const clientSchema = z
  .strictObject({
    clientId: value,
    secret: z.string().min(1).max(65536).optional(),
    method: z.enum(["none", "client_secret_basic", "client_secret_post"]),
  })
  .refine((client) =>
    client.method === "none" ? client.secret === undefined : Boolean(client.secret),
  );
const storedTokenSchema = z.strictObject({
  accessToken: z
    .string()
    .min(1)
    .max(65536)
    .regex(/^[A-Za-z0-9\-._~+/]+=*$/),
  refreshToken: z
    .string()
    .min(1)
    .max(65536)
    .refine((v) => !/[\0\r\n]/.test(v))
    .optional(),
  expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  scopes,
});
export function parseStoredOAuthBundle(input: unknown) {
  return parse(
    z.strictObject({ discovery: discoverySchema, client: clientSchema, token: storedTokenSchema }),
    input,
  );
}
export async function revokeOAuthToken(
  grant: { discovery: OAuthDiscovery; client: OAuthClient; token: OAuthToken },
  signal: AbortSignal,
  network: (options: GuardedNetworkOptions) => typeof fetch = guardedFetch,
): Promise<"complete" | "not-advertised" | "uncertain"> {
  const endpoint = grant.discovery.issuer.revocation_endpoint;
  if (!endpoint) return "not-advertised";
  try {
    const body = new URLSearchParams({
      token: grant.token.refreshToken ?? grant.token.accessToken,
      token_type_hint: grant.token.refreshToken ? "refresh_token" : "access_token",
    });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (grant.client.method === "client_secret_basic") {
      const encode = (v: string) => new URLSearchParams({ v }).toString().slice(2);
      headers.Authorization = `Basic ${Buffer.from(`${encode(grant.client.clientId)}:${encode(grant.client.secret ?? "")}`).toString("base64")}`;
    } else {
      body.set("client_id", grant.client.clientId);
      if (grant.client.method === "client_secret_post" && grant.client.secret)
        body.set("client_secret", grant.client.secret);
    }
    const response = await network({
      privateOrigins: grant.discovery.privateOrigins,
      timeoutMs: 10_000,
      credentials: true,
    })(endpoint, { method: "POST", headers, body: body.toString(), signal });
    await response.body?.cancel();
    return response.ok ? "complete" : "uncertain";
  } catch {
    return "uncertain";
  }
}
