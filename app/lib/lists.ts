// Client-safe input list types and limits (the model lives in models/inputList.server.ts).
export type ListKind = "passcode" | "email";
export type ListEntry = { v: string; r?: string };

export const MAX_ENTRIES = 20_000;

// Bulk customer import (app/lib/import.server.ts)
export const MAX_IMPORT_ROWS = 5000;
