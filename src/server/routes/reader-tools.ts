import { Hono } from "hono";
import { z } from "zod";

import {
  MAX_READER_ANNOTATION_NOTE_LENGTH,
  MAX_READER_ANNOTATION_QUOTE_LENGTH,
  MAX_READER_BOOKMARK_LABEL_LENGTH,
  MAX_READER_SECTION_HREF_LENGTH,
  READER_ANNOTATION_COLORS,
  READER_TEXT_VERSION,
} from "../../shared/types";
import {
  normalizeReaderText,
  READER_TEXT_CONTEXT_LENGTH,
} from "../../shared/reader-text";
import {
  createReaderAnnotation,
  createReaderBookmark,
  deleteReaderAnnotation,
  deleteReaderBookmark,
  listReaderAnnotations,
  listReaderBookmarks,
  updateReaderAnnotation,
  updateReaderBookmark,
} from "../services/reader-tools";

const canonicalText = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => normalizeReaderText(value) === value, "Text must use canonical whitespace.");

const contextSchema = canonicalText(READER_TEXT_CONTEXT_LENGTH);
const readerLocationShape = {
  sectionHref: z.string().trim().min(1).max(MAX_READER_SECTION_HREF_LENGTH),
  textVersion: z.literal(READER_TEXT_VERSION),
  offset: z.number().int().nonnegative(),
  prefix: contextSchema,
  suffix: contextSchema,
};

const readerLocationSchema = z
  .object(readerLocationShape)
  .strict()
  .refine((location) => location.prefix.length + location.suffix.length > 0, {
    message: "A reader location needs quote context.",
  });

const readerRangeSchema = z
  .object({
    ...readerLocationShape,
    endOffset: z.number().int().positive(),
    exact: canonicalText(MAX_READER_ANNOTATION_QUOTE_LENGTH).refine(
      (value) => value.trim().length > 0,
      "Selected text cannot be blank.",
    ),
  })
  .strict()
  .refine((range) => range.endOffset > range.offset, {
    message: "The selection end must follow its start.",
  })
  .refine((range) => range.endOffset - range.offset === range.exact.length, {
    message: "The selection offsets must match the selected text.",
  });

const labelSchema = z
  .string()
  .max(MAX_READER_BOOKMARK_LABEL_LENGTH)
  .transform((value) => value.trim() || null)
  .nullable();
const noteSchema = z
  .string()
  .max(MAX_READER_ANNOTATION_NOTE_LENGTH)
  .transform((value) => value.trim() || null)
  .nullable();

const createBookmarkSchema = z
  .object({
    location: readerLocationSchema,
    label: labelSchema.optional(),
  })
  .strict();
const updateBookmarkSchema = z.object({ label: labelSchema }).strict();
const createAnnotationSchema = z
  .object({
    range: readerRangeSchema,
    color: z.enum(READER_ANNOTATION_COLORS),
    note: noteSchema.optional(),
  })
  .strict();
const updateAnnotationSchema = z
  .object({
    color: z.enum(READER_ANNOTATION_COLORS).optional(),
    note: noteSchema.optional(),
  })
  .strict()
  .refine((payload) => payload.color !== undefined || payload.note !== undefined, {
    message: "Choose a highlight field to update.",
  });

export const readerToolsRoutes = new Hono();

readerToolsRoutes.get("/:bookId/bookmarks", (c) =>
  c.json({ bookmarks: listReaderBookmarks(c.req.param("bookId")) }),
);

readerToolsRoutes.post("/:bookId/bookmarks", async (c) => {
  const payload = createBookmarkSchema.parse(await c.req.json());
  return c.json({ bookmark: createReaderBookmark(c.req.param("bookId"), payload) }, 201);
});

readerToolsRoutes.patch("/:bookId/bookmarks/:bookmarkId", async (c) => {
  const payload = updateBookmarkSchema.parse(await c.req.json());
  return c.json({
    bookmark: updateReaderBookmark(
      c.req.param("bookId"),
      c.req.param("bookmarkId"),
      payload,
    ),
  });
});

readerToolsRoutes.delete("/:bookId/bookmarks/:bookmarkId", (c) =>
  c.json({
    deletion: deleteReaderBookmark(c.req.param("bookId"), c.req.param("bookmarkId")),
  }),
);

readerToolsRoutes.get("/:bookId/annotations", (c) =>
  c.json({ annotations: listReaderAnnotations(c.req.param("bookId")) }),
);

readerToolsRoutes.post("/:bookId/annotations", async (c) => {
  const payload = createAnnotationSchema.parse(await c.req.json());
  return c.json({ annotation: createReaderAnnotation(c.req.param("bookId"), payload) }, 201);
});

readerToolsRoutes.patch("/:bookId/annotations/:annotationId", async (c) => {
  const payload = updateAnnotationSchema.parse(await c.req.json());
  return c.json({
    annotation: updateReaderAnnotation(
      c.req.param("bookId"),
      c.req.param("annotationId"),
      payload,
    ),
  });
});

readerToolsRoutes.delete("/:bookId/annotations/:annotationId", (c) =>
  c.json({
    deletion: deleteReaderAnnotation(c.req.param("bookId"), c.req.param("annotationId")),
  }),
);
