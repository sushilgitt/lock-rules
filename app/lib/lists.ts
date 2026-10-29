// Client-safe input list types and limits (the model lives in models/inputList.server.ts).
export type ListKind = "passcode" | "email";
export type ListEntry = { v: string; r?: string };

export const MAX_ENTRIES = 20_000;
