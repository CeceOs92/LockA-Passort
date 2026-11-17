export interface SummaryInput {
  passportId: string;
  providerId?: string;
  accessId?: number;
  records: string[];
}

export interface SummaryService {
  summarize(input: SummaryInput): Promise<string>;
}

export class StubSummaryService implements SummaryService {
  async summarize(input: SummaryInput): Promise<string> {
    return `AI summaries are not configured. ${input.records.length} consented record(s) available for passport ${input.passportId}.`;
  }
}
