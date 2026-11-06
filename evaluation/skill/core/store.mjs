import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
export const digest = value => hash(canonical(value));
export const id = prefix => `${prefix}-${randomUUID()}`;
export const now = () => new Date().toISOString();
export const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export async function writeJson(file, value, exclusive = false) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (exclusive) return fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await fs.rename(temp, file);
}
export function inside(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..' || p.includes(':'))) throw Error(`UNSAFE_PATH: ${relative}`);
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw Error('PATH_ESCAPE');
  return target;
}
export async function safeDirectory(directory, create = false) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let cursor = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (create) await fs.mkdir(cursor).catch(e => { if (e.code !== 'EEXIST') throw e; });
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error(`UNSAFE_DIRECTORY: ${cursor}`);
  }
  return absolute;
}
export async function inventory(root) {
  await safeDirectory(root);
  const files = [], names = new Set();
  async function walk(directory, prefix = '') {
    for (const entry of (await fs.readdir(directory)).sort()) {
      const relative = prefix + entry, file = inside(root, relative), stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw Error(`LINK_REFUSED: ${file}`);
      const folded = relative.toLowerCase();
      if (names.has(folded)) throw Error(`CASE_COLLISION: ${relative}`);
      names.add(folded);
      if (stat.isDirectory()) await walk(file, relative + '/');
      else if (stat.isFile()) { const bytes = await fs.readFile(file); files.push({ path: relative, size: bytes.length, sha256: hash(bytes) }); }
      else throw Error(`SPECIAL_FILE_REFUSED: ${relative}`);
    }
  }
  await walk(root);
  return files;
}
export async function freeze(source, destination, excluded = []) {
  const before = (await inventory(source)).filter(file => !excluded.includes(file.path));
  await safeDirectory(destination, true);
  for (const file of before) {
    const target = inside(destination, file.path);
    await safeDirectory(path.dirname(target), true);
    await fs.copyFile(inside(source, file.path), target, fs.constants.COPYFILE_EXCL);
  }
  if (digest(before) !== digest(await inventory(destination))) throw Error('COPY_MISMATCH');
  return before;
}
export async function verifyTree(root, expected) {
  if (digest(await inventory(root)) !== digest(expected)) throw Error(`EVIDENCE_CHANGED: ${root}`);
}
export function schema(record) {
  if (record.schema_version !== '1.0') throw Error('UNSUPPORTED_SCHEMA');
  return record;
}
