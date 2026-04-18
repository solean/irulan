import type {
  BookDetail,
  BookReader,
  BookSummary,
  DeliveryRecord,
  ImportResult,
  SettingsPayload,
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
  async listBooks(query: string) {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set("q", query.trim());
    }

    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const payload = await request<{ books: BookSummary[] }>(`/api/books${suffix}`);
    return payload.books;
  },

  async importBooks(files: File[]) {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    const payload = await request<{ results: ImportResult[] }>("/api/books/import", {
      method: "POST",
      body: formData,
    });

    return payload.results;
  },

  async getBook(bookId: string) {
    const payload = await request<{ book: BookDetail }>(`/api/books/${bookId}`);
    return payload.book;
  },

  async getBookReader(bookId: string) {
    const payload = await request<{ reader: BookReader }>(`/api/books/${bookId}/read`);
    return payload.reader;
  },

  async getDeliveries(bookId: string) {
    const payload = await request<{ deliveries: DeliveryRecord[] }>(
      `/api/books/${bookId}/deliveries`,
    );
    return payload.deliveries;
  },

  async sendBook(bookId: string, recipientEmail?: string) {
    const payload = await request<{ delivery: DeliveryRecord }>(`/api/books/${bookId}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipientEmail: recipientEmail?.trim() || null,
      }),
    });

    return payload.delivery;
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
