import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, OptionsSchema } from "@/lib/api";
import { rankStops } from "@/lib/rank";
import type { Candidate, StopSlot } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;

const Body = OptionsSchema.extend({
  departure: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  stops: z
    .array(
      z.object({
        slot: z.custom<StopSlot>((v) => typeof v === "object" && v !== null && typeof (v as StopSlot).index === "number"),
        candidates: z.array(z.custom<Candidate>((v) => typeof v === "object" && v !== null && typeof (v as Candidate).id === "string")).max(30),
      }),
    )
    .max(20),
});

/** Etap 4: ranking AI (Claude) z heurystyką zapasową. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const result = await rankStops(body);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
