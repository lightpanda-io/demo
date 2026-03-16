import http from "http";
import https from "https";
import crypto from "crypto";

function parseSignatureInput(header) {
  const result = {};
  for (const entry of header.split(',')) {
    const eq = entry.indexOf('=');
    if (eq === -1) continue;
    const label = entry.slice(0, eq).trim();
    const rest = entry.slice(eq + 1).trim();
    const closeParen = rest.indexOf(')');
    if (closeParen === -1) continue;
    const compRaw = rest.slice(1, closeParen);
    const paramRaw = rest.slice(closeParen + 1);
    const components = compRaw.split('"').filter((_, i) => i % 2 === 1);
    const params = {};
    for (const param of paramRaw.split(';').slice(1)) {
      const eq2 = param.indexOf('=');
      if (eq2 === -1) continue;
      const k = param.slice(0, eq2);
      const v = param.slice(eq2 + 1).replace(/^"|"$/g, '');
      params[k] = /^\d+$/.test(v) ? parseInt(v) : v;
    }
    result[label] = { components, params };
  }
  return result;
}

function parseSignatureHeader(header) {
  const result = {};
  for (const entry of header.split(',')) {
    const entry2 = entry.trim();
    const eq = entry2.indexOf('=');
    if (eq === -1) continue;
    const label = entry2.slice(0, eq).trim();
    const b64 = entry2.slice(eq + 1).trim().replace(/^:|:$/g, '');
    result[label] = Buffer.from(b64, 'base64');
  }
  return result;
}

async function fetchJwks(agentUrl) {
  const url = agentUrl.trim().replace(/^"|"$/g, '').replace(/\/$/, '');

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Accept: "application/http-message-signatures-directory+json, application/json" },
      timeout: 5000,
    }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          console.log(`[jwks] HTTP ${res.statusCode} from ${url}:\n${body.slice(0, 500)}`);
          return reject(new Error(`Failed to fetch JWKS from ${url}: HTTP ${res.statusCode}`));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Failed to parse JWKS: ${e.message}`)); }
      });
    });
    req.on("error", (e) => reject(new Error(`Failed to fetch JWKS from ${url}: ${e.message}`)));
    req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout fetching JWKS from ${url}`)); });
  });
}

function jwkThumbprint(key) {
  const canonical = JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x });
  return crypto.createHash("sha256").update(canonical).digest("base64url");
}

function findKey(jwks, keyid) {
  for (const key of jwks.keys ?? []) {
    if (key.kty !== "OKP" || key.crv !== "Ed25519" || !key.x) continue;
    const thumbprint = jwkThumbprint(key);
    console.log(`[jwks] key thumbprint: ${thumbprint}`);
    if (thumbprint === keyid) {
      return crypto.createPublicKey({ key: { kty: key.kty, crv: key.crv, x: key.x }, format: "jwk" });
    }
  }
  throw new Error(`No key with thumbprint '${keyid}' found in JWKS`);
}

function buildSignatureBase(components, params, headers, method, path, authority) {
  const lines = [];
  for (const component of components) {
    if (component === "@method") lines.push(`"@method": ${method.toUpperCase()}`);
    else if (component === "@authority") lines.push(`"@authority": ${authority}`);
    else if (component === "@path") lines.push(`"@path": ${path.split("?")[0]}`);
    else if (component === "@query") lines.push(`"@query": ${path.includes("?") ? "?" + path.split("?")[1] : "?"}`);
    else if (component === "@target-uri") lines.push(`"@target-uri": https://${authority}${path}`);
    else if (component === "@request-target") lines.push(`"@request-target": ${path}`);
    else lines.push(`"${component}": ${headers[component.toLowerCase()] ?? ""}`);
  }
  const compStr = components.map((c) => `"${c}"`).join(" ");
  const paramStr = Object.entries(params)
    .map(([k, v]) => typeof v === "number" ? `;${k}=${v}` : `;${k}="${v}"`)
    .join("");
  lines.push(`"@signature-params": (${compStr})${paramStr}`);
  return lines.join("\n");
}

async function validate(headers, method, path, authority) {
  const sigInputRaw = headers["signature-input"];
  const sigRaw = headers["signature"];
  const agentUrl = headers["signature-agent"];

  if (!sigInputRaw) return [400, { error: "Missing Signature-Input header" }];
  if (!sigRaw) return [400, { error: "Missing Signature header" }];
  if (!agentUrl) return [400, { error: "Missing Signature-Agent header" }];

  const sigInputs = parseSignatureInput(sigInputRaw);
  const signatures = parseSignatureHeader(sigRaw);

  const label = Object.keys(sigInputs)[0];
  if (!label) return [400, { error: "Signature-Input parsed to empty" }];
  if (!signatures[label]) return [400, { error: `Signature-Input label '${label}' not present in Signature` }];

  const { components, params } = sigInputs[label];

  if (params.tag !== "web-bot-auth")
    return [400, { error: `Missing or wrong tag parameter (got: ${JSON.stringify(params.tag)})` }];
  if (!params.keyid)
    return [400, { error: "Missing keyid parameter in Signature-Input" }];

  if (params.expires && params.expires < Math.floor(Date.now() / 1000)) {
    console.log(`[401] Signature expired: expires=${params.expires} now=${Math.floor(Date.now() / 1000)}`);
    return [401, { error: `Signature expired at ${params.expires}` }];
  }

  let jwks;
  try {
    jwks = await fetchJwks(agentUrl);
    console.log(`[jwks] Fetched ${jwks.keys?.length ?? 0} key(s) from ${agentUrl}`);
  } catch (e) {
    console.log(`[401] JWKS fetch failed: ${e.message}`);
    return [401, { error: e.message }];
  }

  let publicKey;
  try {
    publicKey = findKey(jwks, params.keyid);
    console.log(`[jwks] Found key: ${params.keyid}`);
  } catch (e) {
    console.log(`[401] Key lookup failed: ${e.message}`);
    return [401, { error: e.message }];
  }

  const sigBase = buildSignatureBase(components, params, headers, method, path, authority);
  const sigBytes = signatures[label];

  console.log(`[verify] components: ${JSON.stringify(components)}`);
  console.log(`[verify] params:     ${JSON.stringify(params)}`);
  console.log(`[verify] sig_base:\n---\n${sigBase}\n---`);
  console.log(`[verify] sig_bytes:  ${sigBytes.toString("base64")}`);

  const ok = crypto.verify(null, Buffer.from(sigBase), publicKey, sigBytes);
  if (!ok) {
    console.log(`[401] Signature verification failed — sig_base does not match what was signed`);
    return [401, { error: "Signature verification failed", sig_base: sigBase }];
  }

  console.log(`[200] OK — label=${label} keyid=${params.keyid}`);
  return [200, { ok: true, label, keyid: params.keyid, agent: agentUrl, components, sig_base: sigBase }];
}

const server = http.createServer(async (req, res) => {
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v])
  );

  console.log(`[request] ${req.method} ${req.url}`);
  for (const [k, v] of Object.entries(headers)) console.log(`[headers] ${k}: ${v}`);

  const [status, result] = await validate(headers, req.method, req.url, headers["host"] ?? "localhost");

  const body = Buffer.from(JSON.stringify(result, null, 2));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": body.length });
  res.end(body);
  console.log(`[${req.method}] ${req.url} → ${status} (${body})`);

  server.close(() => process.exit(status === 200 ? 0 : 1));
});

server.listen(8989, "127.0.0.1", () => {
  console.log(`Validator listening on http://127.0.0.1:8989 (waiting for one request)`);
});
