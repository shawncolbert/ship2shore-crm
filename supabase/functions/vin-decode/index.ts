import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Vehicle classification for the pipeline card's auto-pricing feature.
// Two modes, both dispatcher-triggered from the frontend (never automatic):
//
//   { vin }                    -- decode a VIN via NHTSA vPIC, map its
//                                  BodyClass to our vehicle_type enum, and
//                                  cache the (make, model, year) -> type
//                                  result. A specific VIN can't be looked up
//                                  without an API call (there's no way to
//                                  learn its make/model/year without one),
//                                  so this path always calls NHTSA.
//
//   { year, make, model }      -- manual-entry fallback when there's no VIN
//                                  (or NHTSA decode failed). This is the path
//                                  that actually skips NHTSA: if that exact
//                                  year/make/model was already decoded from
//                                  some other VIN before, vehicle_type_cache
//                                  answers it with zero external calls. If
//                                  it's genuinely new, we return
//                                  manual_required so the dispatcher picks
//                                  the type themselves from the (always
//                                  editable) Vehicle Type field -- NHTSA has
//                                  no "classify by year/make/model" endpoint,
//                                  only by-VIN.
//
// Every failure path returns a normal 200 with manual_required: true rather
// than throwing/500ing -- a bad VIN or a flaky NHTSA response should never
// block the dispatcher from just typing the vehicle in by hand.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NHTSA_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";
const NHTSA_TIMEOUT_MS = 5000;

const VEHICLE_TYPES = ["small", "sedan", "suv", "truck", "van", "coupe"] as const;
type VehicleType = (typeof VEHICLE_TYPES)[number];

// The browser sends a CORS preflight (OPTIONS) before the real POST because
// this call carries an Authorization header -- without these headers on
// every response (including the OPTIONS one) the browser blocks the request
// before it reaches this function at all, and the client just reports
// "Failed to send a request to the Edge Function" with no other detail.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

function mapBodyClassToVehicleType(bodyClass: string | null | undefined): VehicleType | null {
  const b = (bodyClass || "").toLowerCase();
  if (!b) return null;
  if (/suv|sport utility|crossover|\bcuv\b|multi-purpose/.test(b)) return "suv";
  if (/pickup|truck/.test(b)) return "truck";
  if (/van|minivan/.test(b)) return "van";
  if (/coupe/.test(b)) return "coupe";
  if (/sedan|saloon|hatchback|wagon|convertible|cabriolet/.test(b)) return "sedan";
  if (/mini|small|micro|motorcycle|scooter/.test(b)) return "small";
  return null;
}

function isPlausibleVin(vin: string) {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);
}

async function decodeVin(vin: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NHTSA_TIMEOUT_MS);
  try {
    const res = await fetch(`${NHTSA_URL}/${encodeURIComponent(vin)}?format=json`, { signal: controller.signal });
    if (!res.ok) return null;
    const body = await res.json();
    const result = body?.Results?.[0];
    if (!result) return null;
    return {
      year: result.ModelYear ? String(result.ModelYear) : null,
      make: result.Make ? String(result.Make).trim() : null,
      model: result.Model ? String(result.Model).trim() : null,
      bodyClass: result.BodyClass ? String(result.BodyClass).trim() : null,
      gvwr: result.GVWR ? String(result.GVWR).trim() : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const vin = typeof body?.vin === "string" ? body.vin.trim().toUpperCase() : "";

  if (vin) {
    if (!isPlausibleVin(vin)) {
      return json({ manual_required: true, reason: "That doesn't look like a valid 17-character VIN." });
    }

    const decoded = await decodeVin(vin);
    if (!decoded || (!decoded.make && !decoded.model)) {
      return json({ manual_required: true, reason: "Couldn't decode that VIN — enter the vehicle manually." });
    }

    const vehicle_type = mapBodyClassToVehicleType(decoded.bodyClass);

    if (decoded.make && decoded.model && decoded.year && vehicle_type) {
      await supabase.from("vehicle_type_cache")
        .upsert(
          { make: decoded.make, model: decoded.model, year: decoded.year, body_class: decoded.bodyClass, vehicle_type },
          { onConflict: "make,model,year" },
        );
    }

    return json({
      manual_required: !vehicle_type,
      vin,
      year: decoded.year,
      make: decoded.make,
      model: decoded.model,
      body_class: decoded.bodyClass,
      gvwr: decoded.gvwr,
      vehicle_type,
    });
  }

  const year = typeof body?.year === "string" || typeof body?.year === "number" ? String(body.year).trim() : "";
  const make = typeof body?.make === "string" ? body.make.trim() : "";
  const model = typeof body?.model === "string" ? body.model.trim() : "";

  if (!year || !make || !model) {
    return json({ error: "Provide either vin, or year + make + model." }, 400);
  }

  const { data: cached } = await supabase
    .from("vehicle_type_cache")
    .select("vehicle_type, body_class")
    .eq("make", make).eq("model", model).eq("year", year)
    .maybeSingle();

  if (cached?.vehicle_type) {
    return json({ manual_required: false, year, make, model, body_class: cached.body_class, vehicle_type: cached.vehicle_type, from_cache: true });
  }

  return json({
    manual_required: true,
    year, make, model,
    reason: "Haven't seen this year/make/model before — pick the vehicle type.",
  });
});
