// Public deployment settings only. Credentials belong on the server.
// The Pages packager replaces this file in its output for static hosting.
import { ANDROID_RELEASE } from './android-release.js?v=20261026-github-install';
export const APP_CONFIG = Object.freeze({
  id: 'hiroshi-sensei',
  name: 'Hiroshi sensei',
  phoneURL: 'https://erendragneel.github.io/hiroshi-sensei/',
  aiAppURL: 'https://koa-personal-companion.elijio-villa.chatgpt.site/play/',
  apiBase: '/api',
  androidApp: ANDROID_RELEASE,
});
