import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/** Synthetic external resource/AS only. Never writes or prints token/verifier values. */
export async function oauthServer() {
  const policy = {
    registration: true,
    issuers: undefined as string[] | undefined,
    metadataIssuer: undefined as string | undefined,
    scopes: ["tools.read"],
    escalated: false,
    expireIn: 3600,
    loseRefresh: false,
    tokenError: false,
    holdRefresh: undefined as Promise<void> | undefined,
    holdCall: undefined as Promise<void> | undefined,
    rejectCall: false,
  };
  const counts = {
    discovery: 0,
    registrations: 0,
    codes: 0,
    token: 0,
    refresh: 0,
    revocations: 0,
    initialize: 0,
    discoveryTools: 0,
    calls: 0,
    cancelled: 0,
  };
  const events: {
    path: string;
    method: string;
    authorization: "none" | "bearer" | "basic";
    resourceBound?: boolean;
    pkceValid?: boolean;
  }[] = [];
  const codes = new Map<
    string,
    { client: string; redirect: string; challenge: string; resource: string; scopes: string[] }
  >();
  const access = new Map<string, { refresh: string; scopes: string[] }>();
  const refresh = new Map<string, string[]>();
  const registrations: Record<string, unknown>[] = [];
  let origin = "";
  const send = (
    response: ServerResponse,
    status: number,
    value: unknown,
    headers: Record<string, string> = {},
  ) => {
    response.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers,
    });
    response.end(JSON.stringify(value));
  };
  const text = async (request: IncomingMessage) => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 128 * 1024) throw new Error();
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  const issuer = () => `${origin}/issuer`;
  function issue(authorizationUrl: string) {
    const url = new URL(authorizationUrl),
      query = url.searchParams;
    const redirect = new URL(query.get("redirect_uri") ?? "");
    if (
      url.origin !== origin ||
      query.get("code_challenge_method") !== "S256" ||
      query.get("response_type") !== "code" ||
      redirect.hostname !== "127.0.0.1" ||
      redirect.pathname !== "/oauth/callback"
    )
      throw new Error("Invalid synthetic authorization");
    const code = randomUUID();
    codes.set(code, {
      client: query.get("client_id") ?? "",
      redirect: redirect.href,
      challenge: query.get("code_challenge") ?? "",
      resource: query.get("resource") ?? "",
      scopes: (query.get("scope") ?? "").split(" ").filter(Boolean),
    });
    counts.codes++;
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", query.get("state") ?? "");
    redirect.searchParams.set("iss", issuer());
    return redirect.href;
  }
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", origin);
      const authorization = request.headers.authorization ?? "";
      const event: (typeof events)[number] = {
        path: url.pathname,
        method: request.method ?? "GET",
        authorization: authorization.startsWith("Bearer ")
          ? "bearer"
          : authorization.startsWith("Basic ")
            ? "basic"
            : "none",
      };
      events.push(event);
      if (url.pathname === "/mcp") {
        const token = authorization.replace(/^Bearer /, "");
        if (!access.has(token))
          return send(
            response,
            401,
            { error: "authentication_required" },
            {
              "WWW-Authenticate": `Bearer resource_metadata="${origin}/protected", scope="tools.read"`,
            },
          );
        if (request.method !== "POST") return send(response, 405, {});
        const rpc = JSON.parse(await text(request));
        if (rpc.method === "notifications/cancelled") {
          counts.cancelled++;
          return send(response, 202, {});
        }
        if (!Object.hasOwn(rpc, "id")) return send(response, 202, {});
        let result: unknown;
        if (rpc.method === "initialize") {
          counts.initialize++;
          result = {
            protocolVersion: rpc.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "synthetic-oauth", version: "1" },
          };
        } else if (rpc.method === "tools/list") {
          counts.discoveryTools++;
          result = {
            tools: [
              {
                name: "echo",
                inputSchema: { type: "object", properties: { text: { type: "string" } } },
              },
            ],
          };
        } else if (rpc.method === "tools/call") {
          counts.calls++;
          if (policy.rejectCall) return send(response, 401, { error: "expired" });
          if (policy.holdCall) {
            response.once("close", () => {
              if (!response.writableEnded) counts.cancelled++;
            });
            await policy.holdCall;
          }
          result = { content: [{ type: "text", text: "synthetic result" }] };
        } else
          return send(response, 200, {
            jsonrpc: "2.0",
            id: rpc.id,
            error: { code: -32601, message: "Unsupported method" },
          });
        return send(response, 200, { jsonrpc: "2.0", id: rpc.id, result });
      }
      if (
        url.pathname === "/protected" ||
        url.pathname.startsWith("/.well-known/oauth-protected-resource")
      ) {
        counts.discovery++;
        return send(response, 200, {
          resource: `${origin}/mcp`,
          authorization_servers: policy.issuers ?? [issuer()],
          scopes_supported: policy.scopes,
        });
      }
      if (
        url.pathname === "/.well-known/oauth-authorization-server/issuer" ||
        url.pathname === "/.well-known/openid-configuration/issuer" ||
        url.pathname === "/issuer/.well-known/openid-configuration"
      ) {
        counts.discovery++;
        return send(response, 200, {
          issuer: policy.metadataIssuer ?? issuer(),
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          ...(policy.registration ? { registration_endpoint: `${origin}/register` } : {}),
          revocation_endpoint: `${origin}/revoke`,
          code_challenge_methods_supported: ["S256"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          response_types_supported: ["code"],
          token_endpoint_auth_methods_supported: [
            "none",
            "client_secret_basic",
            "client_secret_post",
          ],
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (url.pathname === "/register" && request.method === "POST") {
        counts.registrations++;
        const registration = JSON.parse(await text(request));
        registrations.push(registration);
        return send(response, 201, {
          client_id: `synthetic-${randomUUID()}`,
          redirect_uris: registration.redirect_uris,
          token_endpoint_auth_method: "none",
        });
      }
      if (url.pathname === "/authorize") {
        const html = (value: string) =>
          value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'none'; form-action 'self' http://127.0.0.1:*; frame-ancestors 'none'",
        });
        response.end(
          `<title>Synthetic authorization server</title><h1>Review synthetic authorization</h1><p>Requested scope: ${html(url.searchParams.get("scope") ?? "None")}</p><form action="/consent" method="get">${[...url.searchParams].map(([key, value]) => `<input type="hidden" name="${html(key)}" value="${html(value)}">`).join("")}<button>Authorize synthetic server</button></form>`,
        );
        return;
      }
      if (url.pathname === "/consent") {
        const redirect = issue(`${origin}/authorize${url.search}`);
        response.writeHead(303, { Location: redirect });
        response.end();
        return;
      }
      if (url.pathname === "/token" && request.method === "POST") {
        const parameters = new URLSearchParams(await text(request));
        let granted: string[];
        if (parameters.get("grant_type") === "authorization_code") {
          counts.token++;
          const code = parameters.get("code") ?? "",
            saved = codes.get(code);
          codes.delete(code);
          const challenge = createHash("sha256")
            .update(parameters.get("code_verifier") ?? "")
            .digest("base64url");
          event.pkceValid = saved?.challenge === challenge;
          event.resourceBound =
            saved?.resource === parameters.get("resource") &&
            parameters.get("resource") === `${origin}/mcp`;
          if (
            !saved ||
            !event.pkceValid ||
            !event.resourceBound ||
            saved.client !== parameters.get("client_id") ||
            saved.redirect !== parameters.get("redirect_uri")
          )
            return send(response, 400, { error: "invalid_grant" });
          granted = saved.scopes;
        } else {
          counts.refresh++;
          const previous = parameters.get("refresh_token") ?? "";
          granted = refresh.get(previous) ?? [];
          event.resourceBound = parameters.get("resource") === `${origin}/mcp`;
          refresh.delete(previous);
          if (!granted.length || !event.resourceBound)
            return send(response, 400, { error: "invalid_grant" });
          await policy.holdRefresh;
          if (policy.loseRefresh) {
            request.socket.destroy();
            return;
          }
        }
        if (policy.tokenError)
          return send(response, 400, {
            error: "invalid_grant",
            error_description: "synthetic-untrusted-description",
          });
        const accessToken = `access-${randomUUID()}`,
          refreshToken = `refresh-${randomUUID()}`;
        access.set(accessToken, { refresh: refreshToken, scopes: granted });
        refresh.set(refreshToken, granted);
        return send(response, 200, {
          access_token: accessToken,
          token_type: "Bearer",
          refresh_token: refreshToken,
          expires_in: policy.expireIn,
          scope: policy.escalated ? "unexpected.admin" : granted.join(" "),
        });
      }
      if (url.pathname === "/revoke" && request.method === "POST") {
        counts.revocations++;
        const parameters = new URLSearchParams(await text(request)),
          token = parameters.get("token");
        for (const [key, value] of access)
          if (key === token || value.refresh === token) access.delete(key);
        if (token) refresh.delete(token);
        return send(response, 200, {});
      }
      send(response, 404, {});
    })().catch(() => {
      if (!response.headersSent) send(response, 400, { error: "synthetic_rejection" });
      else response.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    issuer: issuer(),
    policy,
    counts,
    events,
    registrations,
    issue,
    acceptCredential: (value: string) => {
      access.set(value, { refresh: "manual", scopes: ["tools.read"] });
    },
    accessTokens: () => [...access.keys()],
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
