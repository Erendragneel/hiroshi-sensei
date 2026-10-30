import { copyFile, lstat, mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HIROSHI_WIDGET_HTML } from '../chatgpt-tutor/widget.mjs';

const workspace = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const source = path.join(workspace, 'public');
const output = path.resolve(workspace, 'dist', 'pages');
const allowedExtensions = new Set(['.html', '.css', '.js', '.webmanifest', '.svg', '.png']);
const files = [];

function requireInsideWorkspace(target) {
  const relative = path.relative(workspace, path.resolve(target));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing a path outside the workspace: ${target}`);
  }
}

async function collect(directory, relative = '') {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Expected an ordinary directory: ${directory}`);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = entry.name;
    const sourcePath = path.join(directory, name);
    const relativePath = path.join(relative, name);
    if (name.startsWith('.') || /^env(?:\.|$)/i.test(name) || entry.isSymbolicLink()) {
      throw new Error(`Refusing hidden, environment, or linked content: ${relativePath}`);
    }
    if (entry.isDirectory()) await collect(sourcePath, relativePath);
    else if (entry.isFile() && allowedExtensions.has(path.extname(name).toLowerCase())) files.push(relativePath);
    else throw new Error(`Unsupported public asset: ${relativePath}`);
  }
}

// Validate the complete source before replacing a previous Pages package.
await collect(source);
requireInsideWorkspace(output);
for (const target of [path.dirname(output), output]) {
  try {
    const stats = await lstat(target);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Refusing a linked or non-directory output: ${target}`);
    requireInsideWorkspace(await realpath(target));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const relativePath of files) {
  const destination = path.join(output, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(source, relativePath), destination);
}
await writeFile(path.join(output, '.nojekyll'), '');
await writeFile(path.join(output, 'classroom-preview.html'), HIROSHI_WIDGET_HTML);
await writeFile(path.join(output, 'app-config.js'), `import { ANDROID_RELEASE } from './android-release.js?v=20261030-adaptive-teacher';
export const APP_CONFIG = Object.freeze({
  id: 'hiroshi-sensei',
  name: 'Hiroshi sensei',
  phoneURL: 'https://erendragneel.github.io/hiroshi-sensei/',
  aiAppURL: null,
  androidApp: ANDROID_RELEASE,
  chatgptBackend: 'https://koa-personal-companion.elijio-villa.chatgpt.site',
  apiBase: 'https://koa-personal-companion.elijio-villa.chatgpt.site/api/hiroshi'
});
`);
const fileCount = new Set([...files, '.nojekyll', 'app-config.js', 'classroom-preview.html']).size;
console.log(`GitHub Pages package: ${output}\nFiles: ${fileCount}`);
