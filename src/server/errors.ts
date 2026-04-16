export class AppError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";
