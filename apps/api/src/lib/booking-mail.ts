import nodemailer from 'nodemailer';

// Mails to venues go out from Robin's own address, not from the app's noreply
// sender in mail.ts. A Proton SMTP token belongs to exactly one address, so
// BOOKING_SMTP_USER and BOOKING_FROM name the same one. Proton files the mail
// under Sent, replies land in Robin's inbox.
const port = Number(process.env.BOOKING_SMTP_PORT || 587);
const transport = process.env.BOOKING_SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.BOOKING_SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.BOOKING_SMTP_USER, pass: process.env.BOOKING_SMTP_PASS },
      dnsTimeout: 5000,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10_000,
    })
  : null;

// Without SMTP the mail lands in the log, but only outside production, so
// tests and local dev never reach a venue. In production sending stays off.
export const bookingSender = () =>
  transport ? (process.env.BOOKING_FROM ?? null) : process.env.NODE_ENV === 'production' ? null : 'log';

type BookingMail = { to: string; subject: string; text: string; inReplyTo?: string | null };

// Plain text like a mail Robin writes himself. Returns the Message-ID, a
// follow-up passes it as inReplyTo and stays in the same thread.
export async function sendBookingMail({ to, subject, text, inReplyTo }: BookingMail) {
  const thread = inReplyTo ? { inReplyTo, references: [inReplyTo] } : {};
  if (!transport) {
    const messageId = `<${crypto.randomUUID()}@localhost>`;
    console.log(`[booking-mail] To ${to}: ${subject}\n${text}`);
    return messageId;
  }
  const info = await transport.sendMail({ from: process.env.BOOKING_FROM, to, subject, text, ...thread });
  return info.messageId;
}
