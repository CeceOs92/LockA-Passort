export interface IndexedContractEvent {
  contractId: string;
  ledger: number;
  txHash: string;
  eventIndex: number;
  eventType: string;
  payload: unknown;
}

export interface EventSink {
  handle(event: IndexedContractEvent): Promise<void>;
}

export interface EventIndexer {
  start(): void;
  stop(): void;
}
