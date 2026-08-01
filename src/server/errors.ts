import { ZodError } from "zod";

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

const jsonError = (message: string, status: number) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Turn anything thrown by a route or service into the `{ error }` JSON shape the
 * web client expects. Registered once as the app's error handler, so a handler
 * that forgets to catch cannot downgrade a deliberate 404 into a plain-text 500.
 */
export const toErrorResponse = (error: unknown) => {
  if (error instanceof AppError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof ZodError) {
    return jsonError(error.issues[0]?.message ?? "Invalid request.", 400);
  }

  console.error(error);
  return jsonError(errorMessage(error), 500);
};
