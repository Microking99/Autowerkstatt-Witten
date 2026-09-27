/**
 * Zustellkanäle: E-Mail (Log/SMTP) und Push (Log/Expo Push API).
 * Log-Modi schreiben nie Inhalte mit Tokens ins Log; vollständige Mails landen nur in einem
 * lokalen Ordner (MAIL_LOG_DIR) bzw. im Speicher (Tests).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import nodemailer, { type Transporter } from 'nodemailer';
import { randomToken } from '../lib/crypto';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Maskiert eine E-Mail-Adresse für Logs (m***@example.org). */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

export class LogMailer implements Mailer {
  /** Im Speicher gehaltene Mails (für Tests und Entwicklung) */
  readonly sent: MailMessage[] = [];

  constructor(
    private readonly logger: FastifyBaseLogger | null,
    private readonly dir: string | null = null,
  ) {}

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    let file: string | null = null;
    if (this.dir) {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      file = path.join(this.dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomToken(6)}.txt`);
      await writeFile(file, `An: ${message.to}\nBetreff: ${message.subject}\n\n${message.text}\n`, { mode: 0o600 });
    }
    this.logger?.info({ to: maskEmail(message.to), subject: message.subject, file }, 'E-Mail (Log-Modus, nicht versendet)');
  }
}

export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(
    options: { host: string; port?: number; secure: boolean; user?: string; password?: string },
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port ?? (options.secure ? 465 : 587),
      secure: options.secure,
      auth: options.user ? { user: options.user, pass: options.password ?? '' } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
  }
}

export interface PushMessage {
  title: string;
  body: string;
  /** Zielpfad (Deep Link) */
  path: string;
}

export interface PushSender {
  /** Liefert Tokens zurück, die der Dienst als ungültig gemeldet hat. */
  send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }>;
}

export class LogPushSender implements PushSender {
  readonly sent: Array<{ tokens: string[]; message: PushMessage }> = [];

  constructor(private readonly logger: FastifyBaseLogger | null) {}

  async send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }> {
    this.sent.push({ tokens, message });
    this.logger?.info({ devices: tokens.length, title: message.title, path: message.path }, 'Push (Log-Modus, nicht versendet)');
    return { invalidTokens: [] };
  }
}

/** Expo Push API (https://exp.host/--/api/v2/push/send). */
export class ExpoPushSender implements PushSender {
  constructor(
    private readonly accessToken: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(tokens: string[], message: PushMessage): Promise<{ invalidTokens: string[] }> {
    if (tokens.length === 0) return { invalidTokens: [] };
    const res = await this.fetchImpl('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      },
      body: JSON.stringify(tokens.map((to) => ({ to, title: message.title, body: message.body, data: { path: message.path }, sound: 'default' }))),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Expo Push antwortet mit Status ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
    const invalidTokens: string[] = [];
    (json.data ?? []).forEach((ticket, i) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' && tokens[i]) invalidTokens.push(tokens[i]!);
    });
    return { invalidTokens };
  }
}
