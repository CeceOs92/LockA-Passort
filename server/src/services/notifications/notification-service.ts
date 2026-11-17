export type NotificationChannel = 'email' | 'sms' | 'push' | 'whatsapp';

export interface NotificationInput {
  recipientAddress: string;
  channel: NotificationChannel;
  template: string;
  payload?: Record<string, unknown>;
}

export interface NotificationService {
  send(input: NotificationInput): Promise<void>;
}

export class ConsoleNotificationService implements NotificationService {
  async send(input: NotificationInput): Promise<void> {
    console.info(
      JSON.stringify({
        level: 'info',
        service: 'notifications',
        recipient: input.recipientAddress,
        channel: input.channel,
        template: input.template,
        payload: input.payload ?? {},
      }),
    );
  }
}
