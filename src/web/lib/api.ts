import type {
  BookDetail,
  BookListOptions,
  BookPage,
  BookReader,
  BookshelvesPayload,
  BookshelfSummary,
  DeleteBookResult,
  DeleteBookshelfResult,
  DeliveryRecord,
  ImportResult,
  SmtpSettings,
  SettingsPayload,
  UpdateBookMetadataPayload,
  UpdateSmtpSettingsPayload,
} from "../../shared/types";

const request = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  const payload = await response
    .json()
    .catch(() => ({ error: `Request failed with ${response.status}.` }));

  if (!response.ok) {
    const message =
      typeof payload?.error === "string" ? payload.error : "Request failed.";
    throw new Error(message);
  }

  return payload as T;
};

export const api = {
  async listBooks(options: BookListOptions = {}) {
    const params = new URLSearchParams();
    if (options.query?.trim()) {
      params.set("q", options.query.trim());
    }
    if (options.bookshelfId?.trim()) {
      params.set("bookshelfId", options.bookshelfId.trim());
    }
    if (options.readStatus) {
      params.set("readStatus", options.readStatus);
    }
    if (options.sort) {
      params.set("sort", options.sort);
    }
    if (options.direction) {
      params.set("direction", options.direction);
    }
    if (options.offset !== undefined) {
      params.set("offset", String(options.offset));
    }
    if (options.limit !== undefined) {
      params.set("limit", String(options.limit));
    }

    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return request<BookPage>(`/api/books${suffix}`);
  },

  async importBooks(files: File[], bookshelfIds?: string | string[] | null) {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    const params = new URLSearchParams();
    const targetBookshelfIds = Array.isArray(bookshelfIds) ? bookshelfIds : [bookshelfIds];
    for (const bookshelfId of targetBookshelfIds) {
      if (bookshelfId?.trim()) {
        params.append("bookshelfId", bookshelfId.trim());
      }
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";

    const payload = await request<{ results: ImportResult[] }>(`/api/books/import${suffix}`, {
      method: "POST",
      body: formData,
    });

    return payload.results;
  },

  async getBook(bookId: string) {
    const payload = await request<{ book: BookDetail }>(`/api/books/${bookId}`);
    return payload.book;
  },

  async deleteBook(bookId: string) {
    const payload = await request<{ deletion: DeleteBookResult }>(`/api/books/${bookId}`, {
      method: "DELETE",
    });
    return payload.deletion;
  },

  async getBookReader(bookId: string) {
    const payload = await request<{ reader: BookReader }>(`/api/books/${bookId}/read`);
    return payload.reader;
  },

  async saveBookBookshelves(bookId: string, bookshelfIds: string[]) {
    const payload = await request<{ book: BookDetail }>(`/api/books/${bookId}/bookshelves`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bookshelfIds }),
    });
    return payload.book;
  },

  async saveBookMetadata(bookId: string, metadata: UpdateBookMetadataPayload) {
    const payload = await request<{ book: BookDetail }>(`/api/books/${bookId}/metadata`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(metadata),
    });
    return payload.book;
  },

  async getDeliveries(bookId: string) {
    const payload = await request<{ deliveries: DeliveryRecord[] }>(
      `/api/books/${bookId}/deliveries`,
    );
    return payload.deliveries;
  },

  async sendBook(bookId: string, recipientEmail?: string, bookshelfId?: string | null) {
    const payload = await request<{ delivery: DeliveryRecord }>(`/api/books/${bookId}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bookshelfId: bookshelfId?.trim() || null,
        recipientEmail: recipientEmail?.trim() || null,
      }),
    });

    return payload.delivery;
  },

  async listBookshelves() {
    return request<BookshelvesPayload>("/api/bookshelves");
  },

  async createBookshelf(name: string, kindleEmail: string | null) {
    const payload = await request<{ bookshelf: BookshelfSummary }>("/api/bookshelves", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, kindleEmail }),
    });
    return payload.bookshelf;
  },

  async updateBookshelf(bookshelfId: string, name: string, kindleEmail: string | null) {
    const payload = await request<{ bookshelf: BookshelfSummary }>(
      `/api/bookshelves/${bookshelfId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, kindleEmail }),
      },
    );
    return payload.bookshelf;
  },

  async deleteBookshelf(bookshelfId: string) {
    const payload = await request<{ deletion: DeleteBookshelfResult }>(
      `/api/bookshelves/${bookshelfId}`,
      {
        method: "DELETE",
      },
    );
    return payload.deletion;
  },

  async getSettings() {
    return request<SettingsPayload>("/api/settings");
  },

  async saveSettings(defaultKindleEmail: string | null) {
    return request<SettingsPayload>("/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ defaultKindleEmail }),
    });
  },

  async saveSmtpSettings(smtp: UpdateSmtpSettingsPayload) {
    return request<SettingsPayload>("/api/settings/smtp", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(smtp),
    });
  },

  async sendTestEmail(recipientEmail: string) {
    return request<{ ok: true }>("/api/settings/test-email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipientEmail }),
    });
  },

  async acknowledgeDatabaseRecovery(recoveredAt: string) {
    return request<SettingsPayload>("/api/settings/database-recovery/acknowledge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recoveredAt }),
    });
  },
};
