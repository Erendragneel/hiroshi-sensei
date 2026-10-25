# Hiroshi sensei for Android

This separate Android app bundles the game and connects directly to OpenAI through the documented **Sign in with ChatGPT / ChatGPT plan usage** flow. It does not use the desktop's local model, a PC relay, or the separately billed API key.

## Sign-in recovery in 0.2.3

Version 0.2.3 (version code 4, tag `v0.2.3-android-preview.4`) adds an **Open Hiroshi sensei** button to the browser callback page. Returning opens the existing app; the link itself cannot sign in or supply credentials. The app shows connection errors inline instead of a WebView error alert. **Copy connection details** copies only app version, Android API, connection stage, safe error code, HTTP status, request ID, and exception class when available. Reports are never uploaded automatically.

After browser approval and token exchange succeed, unverified credentials are saved only in an encrypted, short-lived checkpoint. If identity verification is temporarily interrupted, **Continue with ChatGPT** resumes verification without repeating browser approval or exchanging the one-time code again. Unverified credentials cannot authorize AI requests; full signature, issuer, audience, nonce, and account checks still apply. Expired or invalid checkpoints are discarded before a fresh attempt.

Automated local tests cover the complete browser callback, identity verification, encrypted session saving, credential refresh, verification recovery, and rejection/cancellation paths. They use synthetic identities and local service fixtures. No live account sign-in was tested, and the exact failure on the reported phone remains unconfirmed.

## Startup fix in 0.2.2

Version 0.2.2 fixes the API 35+ launch crash caused by requesting a window insets controller before creating the window decor. The original 0.2.1 failure was reproduced against Android 16 framework code, and regression tests now check cold launch, Activity recreation, native bridge assets, restricted WebView settings, and local failure recovery. Startup failures display message-free diagnostics that the user can copy; reports are never uploaded automatically. The update uses the same package and signing key, so installation over the existing app retains its data. GitHub Actions now runs the native startup suite on code changes.

## Current verification boundary

This is an Android preview. OpenAI documents the local open-source sign-in flow, but does not provide an Android-specific guarantee. A successful build and automated checks do **not** establish that this account can authorize ChatGPT plan usage or complete inference on a phone. Those steps require installation, consent in the phone's system browser, and a completed conversation. Do not describe it as verified phone AI until those checks succeed.

Eligible ChatGPT Plus and Pro accounts can use their plan allowance in supported open-source local apps. Account/workspace eligibility, model access, availability, and usage limits apply. This is not unlimited free inference. The app displays models returned for the signed-in account; it cannot promise the same model, history, tools, or reliability as a separate Codex chat. Internet is required for AI conversation. Authored lessons and guided practice remain available offline.

## Install and connect

1. Install **hiroshi-sensei-0.2.3.apk** on your Android phone. Install over the existing Hiroshi app to retain its data; do not uninstall first. Android may ask you to allow installation from the browser or Files app.
2. Open **Hiroshi sensei** and choose **Continue with ChatGPT**. Finish sign-in and grant plan usage in your system browser. The callback returns to a temporary listener on this phone's `127.0.0.1` address; tap **Open Hiroshi sensei** there.
3. Choose one of the models your account offers. Send a real question and verify that a complete reply arrives. If authorization, eligibility, usage, or inference fails, the app reports it and does not switch to separately billed API usage or a smaller model.

The package ID is `io.github.erendragneel.hiroshi`. Its icon, signing key, app storage, and identity are separate from Language Miner and Voice Bridge. Browser/PWA saves do not automatically transfer into Android app storage; use the game's export/import backup controls.

## Privacy

Progress, chats, and notebook notes stay in the app's local WebView storage. Recent relevant context is sent **directly to OpenAI** for AI replies. ChatGPT conversations from other apps are not automatically imported. OAuth credentials remain encrypted with an Android Keystore key in app-private native storage and are never given to browser JavaScript, GitHub, or the game's hosted website. Android backup of the app is disabled. Disconnect removes the local connection; review connected apps and usage in ChatGPT settings to manage account-side access.

## Build

Use JDK 21+ and Android SDK 36. The Android 16 framework startup tests require Java 21. The pinned Gradle wrapper builds the app. `scripts/stage-web.mjs` bundles the root `public/` game and adds the native connection UI without altering the deployed web app.

```powershell
node --test android/scripts/native-bridge.test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File android/scripts/build-release.ps1
```

The release script uses the existing local build tools or `JAVA_HOME` / `ANDROID_HOME`, creates an independent Hiroshi signing key under `%LOCALAPPDATA%/HiroshiSenseiSigning`, and protects its password using Windows DPAPI. Keep that directory safe for future app updates. Keys, passwords, build output, and APKs are excluded from Git. Signed outputs and SHA256 checksums are placed in `android/artifacts/`.

Official references: [overview](https://developers.openai.com/siwc/token-sharing-open-source), [registration](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [credential security](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [preview requirements](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
