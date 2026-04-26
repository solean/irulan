import nodemailer from "nodemailer";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { DeliveryRecord } from "../../shared/types";
import { db } from "../db/client";
import { deliveries } from "../db/schema";
import { AppError } from "../errors";
import { getBookRecord } from "./books";
import { getDefaultKindleEmail, getSmtpSettings } from "./settings";

const emailSchema = z.string().trim().email();

type DeliveryRow = typeof deliveries.$inferSelect;

const serializeDelivery = (delivery: DeliveryRow): DeliveryRecord => ({
  id: delivery.id,
  recipientEmail: delivery.recipientEmail,
  status: delivery.status,
  errorMessage: delivery.errorMessage,
  smtpMessageId: delivery.smtpMessageId,
  createdAt: delivery.createdAt.toISOString(),
  sentAt: delivery.sentAt ? delivery.sentAt.toISOString() : null,
});

const requireTransport = () => {
  const smtp = getSmtpSettings();

  if (!smtp.configured || !smtp.host || !smtp.from) {
    throw new AppError(400, "SMTP is not configured. Add the SMTP settings first.");
  }

  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user
      ? {
          user: smtp.user,
          pass: smtp.pass ?? "",
        }
      : undefined,
  });
};

const resolveRecipient = (recipientEmail?: string | null) => {
  const candidate = recipientEmail?.trim() || getDefaultKindleEmail();
  if (!candidate) {
    throw new AppError(400, "Add a Kindle email address before sending a book.");
  }
  return emailSchema.parse(candidate);
};

const attachmentName = (filename: string) =>
  filename.toLowerCase().endsWith(".epub") ? filename : `${filename}.epub`;

export const listDeliveriesForBook = (bookId: string) =>
  db
    .select()
    .from(deliveries)
    .where(eq(deliveries.bookId, bookId))
    .orderBy(desc(deliveries.createdAt))
    .all()
    .map(serializeDelivery);

export const sendBookToKindle = async (bookId: string, recipientEmail?: string | null) => {
  const book = getBookRecord(bookId);
  const recipient = resolveRecipient(recipientEmail);
  const createdAt = new Date();
  const deliveryId = crypto.randomUUID();

  db.insert(deliveries)
    .values({
      id: deliveryId,
      bookId,
      recipientEmail: recipient,
      status: "pending",
      createdAt,
    })
    .run();

  try {
    const smtp = getSmtpSettings();
    const transporter = requireTransport();
    const result = await transporter.sendMail({
      from: smtp.from,
      to: recipient,
      subject: `Send to Kindle: ${book.title}`,
      text: [
        `Attached is "${book.title}" by ${book.author}.`,
        "",
        "Amazon still requires this sender to be on your approved personal document sender list.",
      ].join("\n"),
      attachments: [
        {
          filename: attachmentName(book.sourceFilename),
          path: book.filePath,
          contentType: "application/epub+zip",
        },
      ],
    });

    const sentAt = new Date();

    db.update(deliveries)
      .set({
        status: "sent",
        sentAt,
        smtpMessageId: result.messageId,
        errorMessage: null,
      })
      .where(eq(deliveries.id, deliveryId))
      .run();
  } catch (error) {
    db.update(deliveries)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown SMTP failure.",
      })
      .where(eq(deliveries.id, deliveryId))
      .run();

    throw new AppError(
      502,
      error instanceof Error ? error.message : "The email could not be sent.",
    );
  }

  const delivery = db.select().from(deliveries).where(eq(deliveries.id, deliveryId)).get();
  if (!delivery) {
    throw new AppError(500, "The delivery completed but the record could not be loaded.");
  }

  return serializeDelivery(delivery);
};

export const sendTestEmail = async (recipientEmail: string) => {
  const recipient = emailSchema.parse(recipientEmail.trim());
  const smtp = getSmtpSettings();
  const transporter = requireTransport();

  await transporter.sendMail({
    from: smtp.from,
    to: recipient,
    subject: "Irulan SMTP test",
    text: "SMTP is configured and Irulan can send mail.",
  });
};
