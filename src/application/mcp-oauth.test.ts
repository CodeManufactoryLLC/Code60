import { expect, it, vi } from "vitest";
import type { McpConnectorDefinition } from "../bridge/index.js";
import type { GuardedNetworkOptions } from "../platform/index.js";
import {
  bearerChallenge,
  createOAuthProof,
  discoverMcpOAuth,
  exchangeOAuthToken,
  type OAuthDiscovery,
  oauthAuthorizationUrl,
  parseStoredOAuthBundle,
  registerOAuthClient,
  revokeOAuthToken,
  verifyMetadataClient,
} from "./mcp-oauth.js";

const discovery = (): OAuthDiscovery => ({
  issuer: {
    issuer: "https://issuer.test/tenant",
    authorization_endpoint: "https://issuer.test/authorize",
    token_endpoint: "https://issuer.test/token",
    registration_endpoint: "https://issuer.test/register",
    code_challenge_methods_supported: ["S256"],
  },
  resource: "https://mcp.test/tools",
  scopes: ["read"],
  privateOrigins: [],
});
const definition: Extract<McpConnectorDefinition, { type: "http" }> = {
  type: "http",
  label: "Test",
  enabled: true,
  url: "https://mcp.test/tools",
  headers: {},
  auth: { type: "oauth", scopes: [] },
};
const signal = () => AbortSignal.timeout(3000);
function network(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls = vi.fn(handler);
  const options: GuardedNetworkOptions[] = [];
  return {
    calls,
    options,
    port: (value: GuardedNetworkOptions) => {
      options.push(value);
      return ((input, init) => calls(String(input), init)) as typeof fetch;
    },
  };
}
it("parses quoted Bearer challenges without leaking descriptions or accepting ambiguous grammar", () => {
  expect(
    bearerChallenge(
      'Basic realm="ignored", Bearer resource_metadata="https://mcp.test/a,b", scope="read write", error_description="private"',
    ),
  ).toEqual({ metadata: "https://mcp.test/a,b", scopes: ["read", "write"] });
  expect(bearerChallenge(null)).toEqual({});
  expect(bearerChallenge("x".repeat(8193))).toEqual({});
  for (const source of [
    'Bearer scope="read", scope="write"',
    'Bearer scope="unfinished',
    'Bearer scope="bad\\',
    'Bearer x="a", invalid=two words',
  ])
    expect(() => bearerChallenge(source)).toThrow(/challenge/);
});
it("requires explicit issuer selection and validates resource, exact issuer and S256 through OIDC fallback", async () => {
  const d = discovery();
  let bad = "";
  const n = network((url) => {
    if (url === definition.url) return new Response(null, { status: 401 });
    if (url.includes("oauth-protected-resource"))
      return Response.json({
        resource: bad === "resource" ? "https://other.test" : d.resource,
        authorization_servers: [d.issuer.issuer, "https://other.test"],
        scopes_supported: ["read"],
      });
    if (url.includes("oauth-authorization-server")) return new Response(null, { status: 404 });
    return Response.json({
      ...d.issuer,
      issuer: bad === "issuer" ? "https://attacker.test" : d.issuer.issuer,
      code_challenge_methods_supported: bad === "pkce" ? ["plain"] : ["S256"],
    });
  });
  expect(
    (await discoverMcpOAuth(definition, undefined, false, signal(), n.port)).issuers,
  ).toHaveLength(2);
  expect(n.calls.mock.calls.some(([url]) => url.includes("openid"))).toBe(false);
  const found = await discoverMcpOAuth(definition, d.issuer.issuer, false, signal(), n.port);
  expect(found.discovery?.scopes).toEqual(["read"]);
  expect(n.calls.mock.calls.some(([url]) => url.includes("openid-configuration/tenant"))).toBe(
    true,
  );
  await expect(
    discoverMcpOAuth(definition, "https://unadvertised.test", false, signal(), n.port),
  ).rejects.toThrow("advertised");
  for (bad of ["resource", "issuer", "pkce"])
    await expect(
      discoverMcpOAuth(definition, d.issuer.issuer, false, signal(), n.port),
    ).rejects.toThrow(/binding|issuer|PKCE/);
});
it("binds metadata-URL registrations to advertised support, client ID and native redirect", async () => {
  const d = discovery();
  d.issuer.client_id_metadata_document_supported = true;
  let client = "https://client.test/client.json",
    redirect = "http://127.0.0.1:1000/oauth/callback";
  const n = network(() =>
    Response.json({
      client_id: client,
      client_name: "Owned registration",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    }),
  );
  await verifyMetadataClient(client, "http://127.0.0.1:2000/oauth/callback", d, signal(), n.port);
  redirect = "http://127.0.0.1:1000/other";
  await expect(
    verifyMetadataClient(client, "http://127.0.0.1:2000/oauth/callback", d, signal(), n.port),
  ).rejects.toThrow("binding");
  client = "https://other.test/client.json";
  await expect(
    verifyMetadataClient(
      "https://client.test/client.json",
      "http://127.0.0.1:2000/oauth/callback",
      d,
      signal(),
      n.port,
    ),
  ).rejects.toThrow("binding");
  d.issuer.client_id_metadata_document_supported = false;
  await expect(verifyMetadataClient(client, redirect, d, signal(), n.port)).rejects.toThrow(
    "unsupported",
  );
});
it("keeps OAuth exchange authentication separate from transport and rejects replay/escalation", async () => {
  const d = discovery();
  let payload: unknown = {
    access_token: "synthetic",
    token_type: "Bearer",
    expires_in: 30,
    scope: "read",
  };
  const n = network(() => Response.json(payload));
  const previous = { accessToken: "old", refreshToken: "refresh", expiresAt: 0, scopes: ["read"] };
  const result = await exchangeOAuthToken(
    d,
    { clientId: "id:a", secret: "secret:b", method: "client_secret_basic" },
    { grant_type: "refresh_token", refresh_token: "refresh" },
    signal(),
    previous,
    n.port,
  );
  expect(result.refreshToken).toBe("refresh");
  expect(result.expiresAt).toBeGreaterThan(Date.now());
  const [url, init] = n.calls.mock.calls[0]!;
  expect(url).toBe(d.issuer.token_endpoint);
  expect(init?.headers).toMatchObject({
    Authorization: `Basic ${Buffer.from("id%3Aa:secret%3Ab").toString("base64")}`,
  });
  expect(new URLSearchParams(String(init?.body)).get("resource")).toBe(d.resource);
  expect(n.options[0]).toMatchObject({ credentials: true });
  payload = { access_token: "synthetic", token_type: "Bearer", scope: "admin" };
  await expect(
    exchangeOAuthToken(d, { clientId: "id", method: "none" }, {}, signal(), previous, n.port),
  ).rejects.toThrow("scope");
  const lost = network(() => {
    throw new Error("Synthetic lost response");
  });
  await expect(
    exchangeOAuthToken(d, { clientId: "id", method: "none" }, {}, signal(), undefined, lost.port),
  ).rejects.toThrow();
  expect(lost.calls).toHaveBeenCalledOnce();
});
it("generates fresh proofs, rejects authorization-parameter overrides and verifies dynamic registration responses", async () => {
  const d = discovery(),
    a = createOAuthProof(),
    b = createOAuthProof();
  expect(a.state).not.toBe(b.state);
  expect(a.verifier).not.toBe(b.verifier);
  const uri = "http://127.0.0.1:1000/oauth/callback";
  expect(
    new URL(oauthAuthorizationUrl(d, { clientId: "id", method: "none" }, uri, a)).searchParams.get(
      "resource",
    ),
  ).toBe(d.resource);
  d.issuer.authorization_endpoint += "?state=attacker";
  expect(() => oauthAuthorizationUrl(d, { clientId: "id", method: "none" }, uri, a)).toThrow(
    "conflicting",
  );
  const n = network(() => Response.json({ client_id: "install", redirect_uris: [uri] }));
  expect(await registerOAuthClient(d, uri, signal(), n.port)).toEqual({
    clientId: "install",
    method: "none",
  });
  expect(JSON.parse(String(n.calls.mock.calls[0]?.[1]?.body))).toMatchObject({
    application_type: "native",
    redirect_uris: [uri],
  });
  const bad = network(() =>
    Response.json({ client_id: "install", redirect_uris: ["http://127.0.0.1/other"] }),
  );
  await expect(registerOAuthClient(d, uri, signal(), bad.port)).rejects.toThrow("binding");
  delete d.issuer.registration_endpoint;
  await expect(registerOAuthClient(d, uri, signal(), n.port)).rejects.toThrow("required");
});
it("validates stored grants deeply and reports remote revocation uncertainty without retry", async () => {
  const d = discovery(),
    grant = {
      discovery: d,
      client: { clientId: "id", method: "none" as const },
      token: { accessToken: "synthetic", expiresAt: null, scopes: ["read"] },
    };
  expect(parseStoredOAuthBundle(grant)).toEqual(grant);
  expect(() =>
    parseStoredOAuthBundle({ ...grant, token: { ...grant.token, accessToken: "bad\r\n" } }),
  ).toThrow("invalid");
  expect(await revokeOAuthToken(grant, signal())).toBe("not-advertised");
  d.issuer.revocation_endpoint = "https://issuer.test/revoke";
  const n = network(() => new Response(null, { status: 500 }));
  expect(await revokeOAuthToken(grant, signal(), n.port)).toBe("uncertain");
  expect(n.calls).toHaveBeenCalledOnce();
});
