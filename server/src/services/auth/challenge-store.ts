export interface ChallengeRecord {
  stellarAddress: string;
  message: string;
  expiresAt: number;
}

export class ChallengeStore {
  private readonly entries = new Map<string, ChallengeRecord>();

  issue(record: ChallengeRecord): void {
    this.prune();
    this.entries.set(record.stellarAddress, record);
  }

  get(stellarAddress: string): ChallengeRecord | undefined {
    this.prune();
    return this.entries.get(stellarAddress);
  }

  remove(stellarAddress: string): void {
    this.entries.delete(stellarAddress);
  }

  private prune(): void {
    const now = Date.now();
    for (const [address, record] of this.entries) {
      if (record.expiresAt <= now) {
        this.entries.delete(address);
      }
    }
  }
}
