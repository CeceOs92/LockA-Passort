export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  wrappedKey: Buffer;
  wrapIv: Buffer;
  wrapTag: Buffer;
  keyId: string;
}

export interface KeyProvider {
  encrypt(plaintext: Buffer): Promise<EncryptedPayload>;
  decrypt(payload: EncryptedPayload): Promise<Buffer>;
}
