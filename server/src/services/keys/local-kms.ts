import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedPayload, KeyProvider } from './key-provider.js';

const algorithm = 'aes-256-gcm';
const keyId = 'local-master-v1';

export class LocalKms implements KeyProvider {
  private readonly masterKey: Buffer;

  constructor(masterKeyHex: string) {
    this.masterKey = Buffer.from(masterKeyHex, 'hex');
    if (this.masterKey.length !== 32) {
      throw new Error('VAULT_MASTER_KEY must be 32 bytes encoded as hex');
    }
  }

  async encrypt(plaintext: Buffer): Promise<EncryptedPayload> {
    const dataKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv(algorithm, dataKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const wrapIv = randomBytes(12);
    const wrapCipher = createCipheriv(algorithm, this.masterKey, wrapIv);
    const wrappedKey = Buffer.concat([
      wrapCipher.update(dataKey),
      wrapCipher.final(),
    ]);
    const wrapTag = wrapCipher.getAuthTag();

    return { ciphertext, iv, tag, wrappedKey, wrapIv, wrapTag, keyId };
  }

  async decrypt(payload: EncryptedPayload): Promise<Buffer> {
    if (payload.keyId !== keyId) {
      throw new Error(`Unsupported key id: ${payload.keyId}`);
    }

    const unwrap = createDecipheriv(algorithm, this.masterKey, payload.wrapIv);
    unwrap.setAuthTag(payload.wrapTag);
    const dataKey = Buffer.concat([
      unwrap.update(payload.wrappedKey),
      unwrap.final(),
    ]);

    const decipher = createDecipheriv(algorithm, dataKey, payload.iv);
    decipher.setAuthTag(payload.tag);
    return Buffer.concat([
      decipher.update(payload.ciphertext),
      decipher.final(),
    ]);
  }
}
