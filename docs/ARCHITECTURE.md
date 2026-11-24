# Architecture

<p align="center">
  <img src="images/lumen-logo.svg" alt="Lumen" width="100" />
</p>

This page explains how the sample app is put together and why each piece exists. You don't need to read this to use the app — but if you're curious how it works, or you want to extend it, this is the tour.

---

## The picture

```
+--------------------+       +----------------------+       +-----------------------+
|  Browser (5173)    |  -->  |  Express BFF (8787)  |  -->  |  Lumen Wallet API     |
|  Vite + React JSX  |       |  thin proxy          |       |  (hosted on AWS)      |
|  Tailwind 4        |       |  + helmet + CORS     |       |                       |
|                    |       |  + rate limit        |       |  4 auth endpoints     |
|  sessionStorage:   |       |  + Zod body check    |       |  (Custodial)          |
|   user token       |       |  injects:            |       |                       |
|   wallet           |       |   lumen-api-key      |       |                       |
|                    |       |   lumen-api-secret   |       |                       |
+--------------------+       +----------------------+       +-----------------------+
       ^                                                                ^
       |                                                                |
       |   redirect back with ?AuthCode=                                 |
       +-------------------- BridgePass (Lumen-hosted) <-----------------+
                                  (separate origin)
```

There are three boxes plus one detour:

1. **The browser part** (the React app at `http://localhost:5173`). This is what you see and click on.
2. **The local Express server** at `http://localhost:8787`. A small program running on your computer that acts as a middleman.
3. **The Lumen Wallet API** out on the internet (hosted on AWS). The real source of authentication and wallet data.
4. **BridgePass** — a separate page hosted by Lumen where the actual login happens. The browser visits it directly during the OAuth flow.

Both halves of your local app read from a single `.env` settings file at the project root.

> **Note:** **BFF** stands for "Backend For Frontend" — a small backend server dedicated to one specific frontend. It's the polite term for "tiny middleman server".

---

## Why is there a backend server at all?

The short answer: **to keep your API secret hidden.**

Here's the long version. Vite and React projects bundle their settings (anything starting with `VITE_`) directly into the JavaScript file that gets sent to every browser. That means if we put `LUMEN_API_SECRET=...` into a `VITE_` variable, anyone visiting the site could open their browser's developer tools (F12) and copy your secret right out of the JavaScript code.

The Express server side-steps that completely. It stays on **your** machine (or, if you deploy it later, on your hosting provider's server). It holds the secret. When the React app asks for a login URL or for a session token, it asks the Express server. The Express server then asks Lumen — with the secret attached. Lumen replies. The Express server hands the reply back to the React app.

The browser never sees the secret. Even if someone inspects every byte of the JavaScript that runs in your browser, the secret isn't there.

---

## The BridgePass OAuth flow (the headline)

This is the core mechanic of the sample. It's a 10-step dance that happens every time a user signs in.

1. The user opens the app and lands on `/login`. The React page asks the Express server, "give me a BridgePass login URL". This is `POST /api/auth/login-config` with a small body describing which login methods are allowed (Google, Facebook) and where to send the user back (the `RedirectURL` — set to `http://localhost:5173/callback`).
2. The Express server forwards that request to Lumen, with your API key and secret attached. Lumen replies with a `LoginURL` (a long https link that points at BridgePass) and a `Config` object.
3. The Express server hands that reply back to the browser.
4. The React page sets `window.location.href` to the `LoginURL`. The browser leaves your app and lands on the BridgePass page.
5. On BridgePass, the user picks a login method and completes it (Google sign-in or Facebook sign-in).
6. BridgePass verifies the result and redirects the browser back to `http://localhost:5173/callback?AuthCode=...`. The `AuthCode` is a short-lived, single-use proof that the user really did finish the login. It expires fast.
7. The React `/callback` page reads the `AuthCode` from the URL and immediately sends it to the Express server. This is `GET /api/auth/access-token` with the AuthCode in a header called `lumen-authentication-code`.
8. The Express server forwards that to Lumen. Lumen verifies the AuthCode, marks it as spent, and replies with a `Token` (the session token) plus a `Wallet` object describing the user's wallet.
9. The React app stores both `Token` and `Wallet` in **sessionStorage** — a per-tab storage in the browser that clears when you close the tab. Every later request to the Express server then includes the token in a header called `lumen-user-token`. The Express server forwards that header to Lumen upstream.
10. When the user clicks "Sign out", the React app calls `DELETE /api/auth/logout` (with the token in the header), Lumen invalidates the session, and the React app clears sessionStorage and routes back to `/login`.

> **Note:** **sessionStorage** is one of two small storages every browser provides. Its sibling is `localStorage`, which survives forever until cleared. We picked sessionStorage on purpose: a forgotten browser tab can't stay logged in indefinitely, and the "blast radius" of a stolen token is smaller — closing the tab effectively logs you out.

> **Note:** An **AuthCode** is the OAuth "authorization code" — a one-time-use token issued at the end of the user's login on BridgePass, designed to be exchanged immediately for a longer-lived session token. The exchange happens through your backend so secrets stay off the browser.

On every page reload, if there's a token in sessionStorage, the React app calls `GET /api/auth/authenticate` once to confirm the token is still valid. If Lumen says "no" (401), the app clears the session and routes back to `/login` automatically.

---

## Folder map

```
/                          single root .env, package.json with workspaces
├── server/                Express BFF
│   ├── package.json
│   └── src/
│       ├── index.js              Express bootstrap, security middleware, route mounting
│       ├── lumenClient.js        axios instance with the api-key+secret interceptor
│       ├── middleware/
│       │   ├── envCheck.js       fails fast if .env is missing or unfilled
│       │   ├── errorHandler.js   converts upstream Lumen errors into { ok:false, status, error }
│       │   └── validateQuery.js  Zod schema for login-config body + requireUserToken middleware
│       └── routes/
│           └── auth.routes.js    the 4 proxied auth routes
└── web/                   Vite + React
    ├── vite.config.js     envDir set to '..' so it reads root .env
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx              React entry
        ├── App.jsx               router only
        ├── index.css             Tailwind + Lumen design tokens
        ├── api/client.js         axios pointed at the local BFF, with setUserToken module-level setter
        ├── context/
        │   └── AuthContext.jsx   holds { token, wallet }, hydrates from sessionStorage
        ├── components/
        │   ├── Header.jsx
        │   ├── Layout.jsx
        │   ├── Spinner.jsx
        │   ├── ErrorBanner.jsx
        │   ├── EmptyState.jsx
        │   └── ProtectedRoute.jsx
        └── pages/
            ├── Login.jsx         method checkboxes + "Continue to BridgePass" button
            ├── Callback.jsx      reads ?AuthCode= and exchanges it for a session token
            ├── Dashboard.jsx     (protected) wallet info card
            └── NotFound.jsx
```

In plain English: there are two main folders. `server/` holds the middleman server. `web/` holds the website (React) part. The `.env` file at the very top is shared by both.

---

## The 4 routes

The Express server exposes four paths under `/api/auth`. Each one is a thin proxy: it adds your `lumen-api-key` and `lumen-api-secret` headers (and, where needed, a per-request `lumen-user-token` or `lumen-authentication-code`) before forwarding the request to Lumen.

The full reference is in [API_REFERENCE.md](API_REFERENCE.md).

---

## Security choices

Each row below is a possible attack or mistake, and what we did to block it.

| Concern | Mitigation |
|---|---|
| Secret leakage | The API key and secret live in `.env` (which is in `.gitignore`, so it never goes to Git) and only on the server. The browser-side `VITE_*` variables are intentionally limited to the BFF URL and the callback URL — nothing sensitive. |
| Cross-origin attacks | CORS (Cross-Origin Resource Sharing) is a browser rule limiting which websites can call your server. We use an allowlist driven by `ALLOWED_ORIGIN`. Methods allowed on `/api` are `GET`, `POST`, and `DELETE` only. |
| Header injection | We use Helmet (a security middleware) to set a strict Content Security Policy with an explicit `connect-src` allowlist — so the browser refuses to load resources from unexpected places. `frame-ancestors` is `'none'`, so the app can't be embedded in an iframe. |
| Abuse / runaway scripts | `express-rate-limit` caps `/api/*` at 100 requests per 15 minutes per IP address. If something starts hammering the server, it gets a `429 Too Many Requests` response. |
| Body fuzzing | Zod (a validation library) checks the body of `POST /api/auth/login-config` against an allowlist (`AllowedLoginMethods.SocialMedia` must be a non-empty array of `"GOOGLE"` and/or `"FACEBOOK"`; `RedirectURL` must be a real URL). Junk values get rejected before the request ever reaches Lumen. |
| Oversized JSON | `express.json({ limit: '32kb' })` caps the request body at 32 kilobytes. There's nothing in this sample that needs more than that. |
| Error leakage | Errors from Lumen are normalized into a clean `{ ok, status, error }` shape. Stack traces (which can reveal internal details) never reach the browser. |
| Token theft via XSS | The session token is stored in **sessionStorage** — per-tab, clears on tab close. We didn't use `localStorage` (which persists forever). We didn't use a cookie (which would need CSRF protection). sessionStorage trades off a little user convenience (each tab logs in separately) for a smaller XSS blast radius. |

> **Heads up:** These mitigations are good for a local sample and small deployments. For real production traffic, see "Deploying this" below.

---

## Design system choice

Lumen has a full design system package called `@bayanichain/lumen-design-system`. We deliberately do **not** depend on it in this sample, because that package lives on GitHub Package Registry — meaning every public user would have to set up an `.npmrc` file with an authentication token before `npm install` would work. That would completely break the "anyone can run this in ten minutes" promise of this sample.

Instead, we mirror the four core Lumen design principles directly in plain Tailwind v4:

- **Flat and sharp** — no rounded corners (`border-radius: 0` everywhere, except the loading spinner ring which needs a circle).
- **Monochrome** — black, white, and gray only. The only color exceptions are `#ef4444` for errors and `#22c55e` for success.
- **Typographic** — the Sora font, with tight letter spacing (`tracking: -0.04em`).
- **Minimal** — no shadows, no gradients, 1-pixel solid borders only.

If you're building your own internal app and want to use the real design system, look at how `mvp-baas-org-webapp` wires it up.

---

## What's intentionally NOT here

This sample is deliberately small. We left things out for clarity:

- **No end-user file operations.** Listing or uploading the logged-in user's personal files is the next step up. That's the job of the sister sample, `wallet-and-files-sample-webapp`.
- **No token refresh.** When the session expires, the user is sent back to `/login` and signs in again. A production app might use a refresh-token endpoint to extend the session silently.
- **No multi-tab sync.** Because we use `sessionStorage`, each browser tab is its own session. We don't broadcast a logout from one tab to another. Acceptable for a sample; document the behavior if you ship it.
- **No database, no server-side sessions.** The Express server holds zero state. Restart it any time without losing anything.
- **No "remember me".** Sessions are intentionally short-lived. There's no checkbox to make them last longer.

---

## Deploying this

The local-only flow works as-is. If you want to put this sample on the public internet, here's the short version:

1. **Frontend** — deploy to Vercel or Netlify (both free tiers). Set the environment variable `VITE_BFF_URL` to your backend's public URL, and `VITE_CALLBACK_URL` to `https://your-frontend-domain/callback`.
2. **Backend** — deploy to Render, Railway, or Azure Container Apps. Set `LUMEN_API_KEY`, `LUMEN_API_SECRET`, and `ALLOWED_ORIGIN` (= your frontend's public URL).
3. **CORS update** — make sure `ALLOWED_ORIGIN` matches the deployed frontend URL exactly. Update the Helmet CSP `connect-src` allowlist if it's pointing at a new host.
4. **Register the production callback URL on your API key** — exactly the same step you did for `http://localhost:5173/callback`, but with the deployed frontend's HTTPS URL + `/callback`. BridgePass won't redirect to an unregistered URL.

> **Tip:** For a true production deployment, you'd also want centralized logging, distributed rate limiting (backed by Redis instead of in-memory), and TLS (HTTPS) at both hops. Those upgrades are out of scope for this sample but are well-trodden paths if you want them.
