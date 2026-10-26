# Hiroshi's remembered ChatGPT connection

This is the open-source implementation of the personal backend used by the GitHub game. The game frontend remains on GitHub Pages. The backend requires a Workers-compatible runtime, D1-compatible durable storage, and the hosting platform's verified visitor-identity boundary.

The first computer setup runs `scripts/setup-chatgpt-plan.mjs`. It uses an actual loopback callback and the documented OpenAI public-client flow. The owner approves ChatGPT plan usage in the browser. Credentials are verified locally, encrypted for transfer to the host, independently verified by the host, and used for a completed inference check before connection success is reported. There is no separately billed API-key fallback.

Phone pairing uses a separate one-time, PKCE-bound application code. The browser receives only a scoped Hiroshi device-session token. OpenAI access, refresh and retained identity tokens remain in protected server storage; they never enter the GitHub bundle, browser storage, callback page, analytics or application logs. Durable refresh leases and receipt checkpoints preserve rotating credentials across worker restarts and interrupted identity checks. The hosting platform protects its D1 data at rest; the transfer envelope is not a claim of separate application-level encryption of every stored database record.

Only the owner bound during private setup can authorize a device. The `HIROSHI_ALLOW_OWNER_BOOTSTRAP` flag must be enabled solely while the hosting platform restricts access to the owner. Set it to `0` before allowing public network access. An empty database must then fail closed. Do not expose database query/export endpoints or trust browser-supplied identity headers; the platform must supply and sanitize those headers.

`core.mjs` implements the request handler, and `schema.sql` defines its tables. The Sites adapter imports the handler and passes the platform `env` object. It also retires the former API-key routes so anonymous requests cannot invoke paid inference. CORS permits only `https://erendragneel.github.io`; device and import capabilities remain required independently of CORS. Static GitHub hosting alone cannot provide this server or perform the initial plan authorization.

Run synthetic integration tests with `node --test tests/hosted-plan.test.mjs` from the repository root. They use an in-memory SQLite database, generated signing keys, sealed import envelopes and fixture upstream responses. Passing these tests does not establish live account eligibility or hosting-service availability. Only a completed live inference request establishes access for that request.

Official contracts: [registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [protected remote setup](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms), [inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).
