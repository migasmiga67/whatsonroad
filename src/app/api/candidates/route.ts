import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, OptionsSchema, PlaceSchema } from "@/lib/api";
import { findCandidates } from "@/lib/candidates";
import { ServiceError } from "@/lib/http";
import { getRoute } from "@/lib/providers/route";
import { splitRoute } from "@/lib/split";

export const runtime = "nodejs";
export const maxDuration = 120;

const Body = OptionsSchema.extend({
  from: PlaceSchema,
  to: PlaceSchema,
  slotIndex: z.number().int().min(0).max(50),
});

/** Etap 3: kandydaci na jeden postój (Overpass + Wikipedia). Trasa pochodzi z cache. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const route = await getRoute(body.from, body.to);
    const slot = splitRoute(route, body.intervalHours)[body.slotIndex];
    if (!slot) throw new ServiceError("Planer", "Nie ma takiego postoju na trasie.", false, 400);
    const { candidates, warnings } = await findCandidates(route, slot, body);
    return NextResponse.json({ slot, candidates, warnings });
  } catch (err) {
    return errorResponse(err);
  }
}
