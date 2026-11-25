import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { geocode } from "@/lib/providers/geocode";
import { getRoute } from "@/lib/providers/route";
import { splitRoute } from "@/lib/split";

export const runtime = "nodejs";

const Body = z.object({
  from: z.string().trim().min(2).max(200),
  to: z.string().trim().min(2).max(200),
  intervalHours: z.number().min(1).max(3),
});

/** Etap 1+2: geokodowanie, trasa i podział na odcinki. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const [a, b] = await Promise.all([geocode(body.from), geocode(body.to)]);
    const route = await getRoute(a.place, b.place);
    const slots = splitRoute(route, body.intervalHours);
    return NextResponse.json({ route, slots, geocoder: a.provider });
  } catch (err) {
    return errorResponse(err);
  }
}
