import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type {
  CreateReaderAnnotationPayload,
  CreateReaderBookmarkPayload,
  ReaderAnnotation,
  ReaderBookmark,
  UpdateReaderAnnotationPayload,
  UpdateReaderBookmarkPayload,
} from "../../shared/types";
import { db } from "../db/client";
import { readerAnnotations, readerBookmarks } from "../db/schema";
import { AppError } from "../errors";
import { getBookRecord } from "./books";

type BookmarkRecord = typeof readerBookmarks.$inferSelect;
type AnnotationRecord = typeof readerAnnotations.$inferSelect;

const serializeBookmark = (record: BookmarkRecord): ReaderBookmark => ({
  id: record.id,
  bookId: record.bookId,
  label: record.label,
  location: {
    sectionHref: record.sectionHref,
    textVersion: record.textVersion as ReaderBookmark["location"]["textVersion"],
    offset: record.offset,
    prefix: record.prefix,
    suffix: record.suffix,
  },
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

const serializeAnnotation = (record: AnnotationRecord): ReaderAnnotation => ({
  id: record.id,
  bookId: record.bookId,
  range: {
    sectionHref: record.sectionHref,
    textVersion: record.textVersion as ReaderAnnotation["range"]["textVersion"],
    offset: record.offset,
    endOffset: record.endOffset,
    exact: record.exact,
    prefix: record.prefix,
    suffix: record.suffix,
  },
  color: record.color,
  note: record.note,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
});

const getBookmarkRecord = (bookId: string, bookmarkId: string) => {
  const record = db
    .select()
    .from(readerBookmarks)
    .where(and(eq(readerBookmarks.bookId, bookId), eq(readerBookmarks.id, bookmarkId)))
    .get();
  if (!record) throw new AppError(404, "Bookmark not found.");
  return record;
};

const getAnnotationRecord = (bookId: string, annotationId: string) => {
  const record = db
    .select()
    .from(readerAnnotations)
    .where(and(eq(readerAnnotations.bookId, bookId), eq(readerAnnotations.id, annotationId)))
    .get();
  if (!record) throw new AppError(404, "Highlight not found.");
  return record;
};

export const listReaderBookmarks = (bookId: string): ReaderBookmark[] => {
  getBookRecord(bookId);
  return db
    .select()
    .from(readerBookmarks)
    .where(eq(readerBookmarks.bookId, bookId))
    .orderBy(desc(readerBookmarks.createdAt))
    .all()
    .map(serializeBookmark);
};

export const createReaderBookmark = (
  bookId: string,
  payload: CreateReaderBookmarkPayload,
): ReaderBookmark => {
  getBookRecord(bookId);
  const now = new Date();
  const record: typeof readerBookmarks.$inferInsert = {
    id: randomUUID(),
    bookId,
    label: payload.label ?? null,
    sectionHref: payload.location.sectionHref,
    textVersion: payload.location.textVersion,
    offset: payload.location.offset,
    prefix: payload.location.prefix,
    suffix: payload.location.suffix,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(readerBookmarks).values(record).run();
  return serializeBookmark(getBookmarkRecord(bookId, record.id));
};

export const updateReaderBookmark = (
  bookId: string,
  bookmarkId: string,
  payload: UpdateReaderBookmarkPayload,
): ReaderBookmark => {
  getBookmarkRecord(bookId, bookmarkId);
  db.update(readerBookmarks)
    .set({ label: payload.label, updatedAt: new Date() })
    .where(and(eq(readerBookmarks.bookId, bookId), eq(readerBookmarks.id, bookmarkId)))
    .run();
  return serializeBookmark(getBookmarkRecord(bookId, bookmarkId));
};

export const deleteReaderBookmark = (bookId: string, bookmarkId: string) => {
  getBookmarkRecord(bookId, bookmarkId);
  db.delete(readerBookmarks)
    .where(and(eq(readerBookmarks.bookId, bookId), eq(readerBookmarks.id, bookmarkId)))
    .run();
  return { id: bookmarkId };
};

export const listReaderAnnotations = (bookId: string): ReaderAnnotation[] => {
  getBookRecord(bookId);
  return db
    .select()
    .from(readerAnnotations)
    .where(eq(readerAnnotations.bookId, bookId))
    .orderBy(desc(readerAnnotations.createdAt))
    .all()
    .map(serializeAnnotation);
};

/**
 * Highlighting a passage that is already highlighted recolours the saved
 * annotation. The upsert leans on the unique range index so two readers racing
 * on the same selection cannot stack duplicates over the same text. A payload
 * without a note leaves any saved note alone.
 */
export const createReaderAnnotation = (
  bookId: string,
  payload: CreateReaderAnnotationPayload,
): { annotation: ReaderAnnotation; created: boolean } => {
  getBookRecord(bookId);
  const now = new Date();
  const record: typeof readerAnnotations.$inferInsert = {
    id: randomUUID(),
    bookId,
    sectionHref: payload.range.sectionHref,
    textVersion: payload.range.textVersion,
    offset: payload.range.offset,
    endOffset: payload.range.endOffset,
    exact: payload.range.exact,
    prefix: payload.range.prefix,
    suffix: payload.range.suffix,
    color: payload.color,
    note: payload.note ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const saved = db
    .insert(readerAnnotations)
    .values(record)
    .onConflictDoUpdate({
      target: [
        readerAnnotations.bookId,
        readerAnnotations.sectionHref,
        readerAnnotations.textVersion,
        readerAnnotations.offset,
        readerAnnotations.endOffset,
      ],
      set:
        payload.note === undefined
          ? { color: payload.color, updatedAt: now }
          : { color: payload.color, note: payload.note, updatedAt: now },
    })
    .returning()
    .get();
  return { annotation: serializeAnnotation(saved), created: saved.id === record.id };
};

export const updateReaderAnnotation = (
  bookId: string,
  annotationId: string,
  payload: UpdateReaderAnnotationPayload,
): ReaderAnnotation => {
  const current = getAnnotationRecord(bookId, annotationId);
  db.update(readerAnnotations)
    .set({
      color: payload.color ?? current.color,
      note: payload.note === undefined ? current.note : payload.note,
      updatedAt: new Date(),
    })
    .where(and(eq(readerAnnotations.bookId, bookId), eq(readerAnnotations.id, annotationId)))
    .run();
  return serializeAnnotation(getAnnotationRecord(bookId, annotationId));
};

export const deleteReaderAnnotation = (bookId: string, annotationId: string) => {
  getAnnotationRecord(bookId, annotationId);
  db.delete(readerAnnotations)
    .where(and(eq(readerAnnotations.bookId, bookId), eq(readerAnnotations.id, annotationId)))
    .run();
  return { id: annotationId };
};
