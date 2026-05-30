import type {
  BookDetail,
  BookReader,
  BookSummary,
  BookshelfSummary,
  DeleteBookResult,
  DeleteBookshelfResult,
  DeliveryRecord,
  ImportResult,
  SmtpSettings,
  SettingsPayload,
  UpdateBookMetadataPayload,
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
  async listBooks(query = "", bookshelfId?: string | null) {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("q", query.trim());
    }
    if (bookshelfId?.trim()) {
      params.set("bookshelfId", bookshelfId.trim());
    }

    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const payload = await request<{ books: BookSummary[] }>(`/api/books${suffix}`);
    return payload.books;
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
    const payload = await request<{ bookshelves: BookshelfSummary[] }>("/api/bookshelves");
    return payload.bookshelves;
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

  async saveSmtpSettings(smtp: Omit<SmtpSettings, "configured" | "source">) {
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
};
