import { glob, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createZip } from '@aklinker1/zero-zip';

const buildDir = '.output/chrome-mv3';
const { version } = JSON.parse(await readFile(path.join(buildDir, 'manifest.json'), 'utf8'));
const archive = createZip({ level: 9 });

for await (const entry of glob('**/*', { cwd: buildDir, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const file = path.join(entry.parentPath, entry.name);
  const relativeName = path.relative(buildDir, file).split(path.sep).join('/');
  archive.addFile('kexu/' + relativeName, await readFile(file));
}

const destination = `.output/kexu-${version}-chrome.zip`;
await writeFile(destination, await archive.toBuffer());
console.log(destination);
