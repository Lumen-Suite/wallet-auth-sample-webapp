# API Reference

<p align="center">
  <img src="images/lumen-logo.svg" alt="Lumen" width="100" />
</p>

This page lists the four internet addresses (routes) the local Express server provides. The website part of the app uses them automatically as you click through the sign-in flow — **you don't need to call them by hand** unless you're curious, debugging, or building something on top of this sample.

> **Note:** A **route** is a specific URL path the server responds to. For example, `POST /api/auth/login-config` is a route. **GET**, **POST**, and **DELETE** are HTTP methods. **GET** means "ask for data". **POST** means "submit data". **DELETE** means "destroy this resource".

Each route is a thin proxy: the local Express server attaches your `lumen-api-key` and `lumen-api-secret` headers (and a per-request user token or auth code where applicable), then forwards the call to the real Lumen Wallet API.

**Base URL when running locally:** `http://localhost:8787`

> **Tip:** A **base URL** is the part of the address that goes in front of every route. So `POST /api/auth/login-config` actually lives at `http://localhost:8787/api/auth/login-config` when you run the app on your own computer.

---

## Route 1 — Build the BridgePass login URL

### `POST /api/auth/login-config`

The first step of the sign-in flow. You tell the server which login methods you want to allow and where BridgePass should send the user back. The server returns a `LoginURL` to point the browser at.

### Body

The body must be JSON. Validated by Zod before the request leaves your server.

```json
{
  "AllowedLoginMethods": {
    "Wallets": ["METAMASK"],
    "SocialMedia": ["GOOGLE", "FACEBOOK"]
  },
  "RedirectURL": "http://localhost:5173/callback"
}
```

| Field | Type | Notes |
|---|---|---|
| `AllowedLoginMethods.Wallets` | array, optional | Currently only `"METAMASK"` is supported. |
| `AllowedLoginMethods.SocialMedia` | array, optional | One or both of `"GOOGLE"`, `"FACEBOOK"`. |
| `RedirectURL` | string (a real URL) | Must match a redirect URL you registered on your API key. |

> **Heads up:** You must include at least one method between `Wallets` and `SocialMedia`. Sending both arrays empty (or omitting both) is a `400`.

### Example

```
curl -X POST "http://localhost:8787/api/auth/login-config" \
  -H "Content-Type: application/json" \
  -d '{"AllowedLoginMethods":{"SocialMedia":["GOOGLE"]},"RedirectURL":"http://localhost:5173/callback"}'
```

> **What you should see:** A JSON object with a `LoginURL` field (a long https link) and a `Config` object.

### Response shape

```json
{
  "LoginURL": "https://bridgepass.lumen.example/auth?...",
  "Config": { "...": "opaque" }
}
```

### What it wraps

`POST {LUMEN_API_BASE_URL}/Custodial/login-config` — with your org `lumen-api-key` and `lumen-api-secret` attached server-side.

---

## Route 2 — Exchange the AuthCode for a session token

### `GET /api/auth/access-token`

After BridgePass finishes the login, it redirects the browser back to `/callback?AuthCode=...`. The React app reads that `AuthCode` and immediately hands it to this route, which trades it in for a session token.

### Headers

| Name | What it holds |
|---|---|
| `lumen-authentication-code` | The single-use `AuthCode` from the redirect URL. |

> **Heads up:** The AuthCode is **single-use**. Refreshing the callback page after a successful exchange will produce a `400` the second time, because Lumen has already marked the code as spent.

### Example

```
curl "http://localhost:8787/api/auth/access-token" \
  -H "lumen-authentication-code: AUTH-CODE-FROM-REDIRECT"
```

> **What you should see:** A JSON object with a `Token` (containing the session token and its expiry) and a `Wallet` describing the logged-in user's wallet.

### Response shape

```json
{
  "Token": {
    "token": "long-opaque-session-token",
    "expiresAt": "2026-05-22T14:00:00.000Z"
  },
  "Wallet": {
    "WalletAddress": "0x1234...abcd",
    "Provider": { "AccountName": "Alice", "Email": "alice@example.com" }
  }
}
```

### What it wraps

`GET {LUMEN_API_BASE_URL}/Custodial/access-token` — with the AuthCode forwarded as a header.

---

## Route 3 — Confirm the session token is still valid

### `GET /api/auth/authenticate`

The React app calls this once on every page reload, to make sure the token it pulled out of sessionStorage hasn't expired. If Lumen says no (`401`), the app clears the session and routes back to `/login`.

### Headers

| Name | What it holds |
|---|---|
| `lumen-user-token` | The session token from Route 2. |

### Example

```
curl "http://localhost:8787/api/auth/authenticate" \
  -H "lumen-user-token: SESSION-TOKEN-FROM-ROUTE-2"
```

> **What you should see:** A JSON object echoing the current `Token` and `Wallet`, with a fresh expiry. Or a `401` if the token has expired.

### Response shape

```json
{
  "Token": { "token": "...", "expiresAt": "..." },
  "Wallet": { "WalletAddress": "0x...", "Provider": { "..." : "..." } }
}
```

### What it wraps

`GET {LUMEN_API_BASE_URL}/Custodial/authenticate`

---

## Route 4 — End the session

### `DELETE /api/auth/logout`

The React app calls this when the user clicks **Sign out**. Lumen invalidates the session server-side, then the React app clears sessionStorage and routes back to `/login`.

### Headers

| Name | What it holds |
|---|---|
| `lumen-user-token` | The session token to invalidate. |

### Example

```
curl -X DELETE "http://localhost:8787/api/auth/logout" \
  -H "lumen-user-token: SESSION-TOKEN-FROM-ROUTE-2"
```

> **What you should see:** A small JSON object with a `Message` confirming the session was ended.

### Response shape

```json
{ "Message": "Logged out" }
```

### What it wraps

`DELETE {LUMEN_API_BASE_URL}/Custodial/logout`

---

## Error responses

When something goes wrong, every route comes back with the same shape — and the HTTP status code (a 3-digit number that tells you what kind of problem it is) from the upstream Lumen call:

```json
{
  "ok": false,
  "status": 401,
  "error": "Invalid API key"
}
```

> **Note:** **HTTP status codes** are standard 3-digit numbers. Anything starting with `2` means success. `4xx` means the client (you) did something wrong. `5xx` means the server had a problem.

### Common statuses

| Status | What it means | How to fix it |
|---|---|---|
| 400 | Bad body or missing header — for example a missing `lumen-authentication-code`, an empty `AllowedLoginMethods`, or a `RedirectURL` that isn't a valid URL. Zod rejected it before the request ever reached Lumen. | Check the JSON body and required headers against the route above. |
| 401 | Your `LUMEN_API_KEY` or `LUMEN_API_SECRET` is invalid (Route 1), the AuthCode is missing or expired (Route 2), or the session token is missing or expired (Routes 3 and 4). | Re-check `.env`, re-sign-in if needed, save, then restart with `npm start`. |
| 403 | Your API key is valid but doesn't have permission for the WALLETS module on your organization. The BridgePass auth endpoints sit under wallets. | Contact the Lumen team to enable that module. |
| 404 | The route path or upstream resource doesn't exist. | Double-check the URL — easy to mistype. |
| 429 | You hit the local rate limit: **100 requests per 15 minutes per IP**. | Slow down. Wait a few minutes and try again. |
| 500 | Something upstream failed. | Check the terminal where `npm start` is running for more detail. |

---

## Health check (outside `/api`)

### `GET /health`

A tiny endpoint to confirm the server is alive.

### Example

```
curl "http://localhost:8787/health"
```

> **What you should see:**
>
> ```json
> { "ok": true, "service": "was-server" }
> ```

Use this when you suspect the server isn't running and want a quick yes/no answer before debugging anything bigger.
