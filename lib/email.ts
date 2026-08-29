import nodemailer, { type Transporter } from "nodemailer";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export interface EmailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  messageId: string;
  // Ethereal-specific — a URL to view the captured (never actually
  // delivered) email. Real providers (including SmtpEmailProvider below)
  // just won't set this, since the email really was sent.
  previewUrl?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

const FROM_ADDRESS = process.env.EMAIL_FROM || "GreyWatch <alerts@greywatch.local>";

/**
 * Sandbox email delivery via Ethereal (Nodemailer's fake-SMTP test service)
 * — a disposable inbox account is created on first use, nothing is ever
 * actually delivered, and every send returns a preview URL to view it.
 * Used automatically when no real SMTP credentials are configured (see
 * createEmailProvider below).
 */
export class EtherealEmailProvider implements EmailProvider {
  private transporterPromise: Promise<Transporter> | null = null;

  private async getTransporter(): Promise<Transporter> {
    if (!this.transporterPromise) {
      this.transporterPromise = nodemailer.createTestAccount().then((account) =>
        nodemailer.createTransport({
          host: account.smtp.host,
          port: account.smtp.port,
          secure: account.smtp.secure,
          auth: { user: account.user, pass: account.pass },
        }),
      );
    }
    return this.transporterPromise;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const transporter = await this.getTransporter();
    const info = await transporter.sendMail({
      from: FROM_ADDRESS,
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      html: message.html,
      attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    return { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || undefined };
  }
}

/**
 * Real delivery via any SMTP server — configured for Gmail SMTP
 * (smtp.gmail.com:587) via env vars, but works with any SMTP host/port
 * (an internal relay, another provider's SMTP endpoint, etc.) since
 * nothing here is Gmail-specific beyond the default host.
 *
 * Gmail requires an **App Password**, not your normal account password —
 * see SETUP.md for exactly how to generate one. A regular password will
 * fail auth even with the right address.
 */
export class SmtpEmailProvider implements EmailProvider {
  private transporter: Transporter;

  constructor(config: { host: string; port: number; secure: boolean; user: string; pass: string }) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure, // true for port 465, false for 587 (STARTTLS)
      auth: { user: config.user, pass: config.pass },
    });
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const info = await this.transporter.sendMail({
      from: FROM_ADDRESS,
      to: message.to,
      cc: message.cc,
      subject: message.subject,
      html: message.html,
      attachments: message.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    return { messageId: info.messageId };
  }
}

function createEmailProvider(): EmailProvider {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    const port = Number(SMTP_PORT) || 587;
    console.log(`[email] using real SMTP provider (${SMTP_HOST}:${port}, user ${SMTP_USER})`);
    return new SmtpEmailProvider({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      user: SMTP_USER,
      pass: SMTP_PASS,
    });
  }
  // No real credentials configured — fall back to the sandbox provider
  // rather than failing outright, so the rest of the app keeps working.
  console.log("[email] no SMTP_HOST/SMTP_USER/SMTP_PASS found — falling back to Ethereal sandbox provider");
  return new EtherealEmailProvider();
}

// Single shared instance, chosen once at startup based on whether real
// SMTP credentials are configured.
export const emailProvider: EmailProvider = createEmailProvider();
