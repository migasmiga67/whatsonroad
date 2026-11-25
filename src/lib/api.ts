import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ServiceError } from "./http";
import type { ApiErrorBody } from "./types";

export const PlaceSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  name: z.string().max(200),
  label: z.string().max(300),
});

export const OptionsSchema = z.object({
  intervalHours: z.number().min(1).max(3),
  maxDetourKm: z.number().min(1).max(30),
  interests: z.array(z.enum(["nature", "monuments", "food", "kids", "viewpoints"])).max(5),
  preferMop: z.boolean(),
});

export function errorResponse(err: unknown) {
  if (err instanceof z.ZodError) {
    return NextResponse.json<ApiErrorBody>({ error: "Nieprawidłowe dane formularza: " + err.issues.map((i) => i.path.join(".") + " " + i.message).join("; ") }, { status: 400 });
  }
  if (err instanceof ServiceError) {
    return NextResponse.json<ApiErrorBody>({ error: err.message, service: err.service }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json<ApiErrorBody>({ error: "Nieoczekiwany błąd serwera. Spróbuj ponownie." }, { status: 500 });
}
