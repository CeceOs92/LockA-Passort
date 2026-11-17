import { createHash, randomUUID } from 'node:crypto';
import type { KeyProvider } from '../keys/key-provider.js';
import type { LocalObjectStore } from './local-object-store.js';

export interface StoreObjectInput {
  passportId: string;
  recordId?: string;
  contentType: string;
  bytes: Buffer;
}

export interface VaultObjectMetadata {
  objectKey: string;
  contentHash: string;
  contentType: string;
  sizeBytes: number;
  keyId: string;
}

export interface VaultObject {
  contentType: string;
  bytes: Buffer;
}

interface SerializedPayload {
  contentType: string;
  keyId: string;
  ciphertext: string;
  iv: string;
  tag: string;
  wrappedKey: string;
  wrapIv: string;
  wrapTag: string;
}

export class VaultService {
  constructor(
    private readonly keyProvider: KeyProvider,
    private readonly objectStore: LocalObjectStore,
  ) {}

  async store(input: StoreObjectInput): Promise<VaultObjectMetadata> {
    const objectKey = [
      input.passportId,
      input.recordId ?? 'unassigned',
      randomUUID(),
    ].join('/');
    const encrypted = await this.keyProvider.encrypt(input.bytes);
    const payload: SerializedPayload = {
      contentType: input.contentType,
      keyId: encrypted.keyId,
      ciphertext: encrypted.ciphertext.toString('base64'),
      iv: encrypted.iv.toString('base64'),
      tag: encrypted.tag.toString('base64'),
      wrappedKey: encrypted.wrappedKey.toString('base64'),
      wrapIv: encrypted.wrapIv.toString('base64'),
      wrapTag: encrypted.wrapTag.toString('base64'),
    };

    await this.objectStore.put(
      `${objectKey}.json`,
      Buffer.from(JSON.stringify(payload), 'utf8'),
    );

    return {
      objectKey,
      contentHash: createHash('sha256').update(input.bytes).digest('hex'),
      contentType: input.contentType,
      sizeBytes: input.bytes.byteLength,
      keyId: encrypted.keyId,
    };
  }

  async read(objectKey: string): Promise<VaultObject> {
    const raw = await this.objectStore.get(`${objectKey}.json`);
    const payload = JSON.parse(raw.toString('utf8')) as SerializedPayload;
    const bytes = await this.keyProvider.decrypt({
      ciphertext: Buffer.from(payload.ciphertext, 'base64'),
      iv: Buffer.from(payload.iv, 'base64'),
      tag: Buffer.from(payload.tag, 'base64'),
      wrappedKey: Buffer.from(payload.wrappedKey, 'base64'),
      wrapIv: Buffer.from(payload.wrapIv, 'base64'),
      wrapTag: Buffer.from(payload.wrapTag, 'base64'),
      keyId: payload.keyId,
    });

    return { contentType: payload.contentType, bytes };
  }
}
