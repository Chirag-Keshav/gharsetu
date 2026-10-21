/**
 * SmsProvider adapter (SPEC §5). The real Indian SMS vendor is Business-pending (§19); it plugs in
 * here without touching business code. Sender/template registration is the vendor's concern.
 */
import { randomUUID } from 'node:crypto';
import { maskPhone } from '@propcare/shared';
import { log } from '../core/logger';

export interface SmsMessage {
  to: string;
  body: string;
  /** Template identifier; OTP bodies are never printed or logged. */
  template: 'otp' | 'notification';
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<{ providerRef: string }>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/**
 * Development-only provider. Prints non-OTP messages with a masked number and keeps the last
 * messages in memory so tests can read them. In development, use OTP_TEST_MODE for the fixed code.
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  readonly sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<{ providerRef: string }> {
    this.sent.push(message);
    if (this.sent.length > 200) this.sent.shift();
    const shown = message.template === 'otp' ? '(sign-in code withheld from logs)' : message.body;
    if (process.env.NODE_ENV !== 'test') log.info('dev_sms', { to: maskPhone(message.to), template: message.template, body: shown });
    return { providerRef: `console_${randomUUID()}` };
  }

  /** Test helper: latest OTP sent to a number. */
  lastCodeFor(phoneE164: string): string | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = this.sent[i];
      if (m.to === phoneE164 && m.template === 'otp') return /(\d{4,8})/.exec(m.body)?.[1] ?? null;
    }
    return null;
  }
}
