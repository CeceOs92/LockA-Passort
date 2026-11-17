import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, normalize, resolve, sep } from 'node:path';

export class LocalObjectStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  private pathFor(key: string): string {
    const safeKey = normalize(key).replace(/^[/\\]+/, '');
    const path = resolve(this.root, safeKey);

    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error('Invalid object key');
    }

    return path;
  }
}
