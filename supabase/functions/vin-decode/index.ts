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

// Best-effort fallback when there's no BodyClass to go on -- the manual
// Year/Make/Model path (no VIN) with nothing in vehicle_type_cache yet, since
// NHTSA has no "classify by make/model" endpoint to fall back to. Matched
// against common model names so the common case (a Highlander, an F-150)
// still gets an answer instead of a dead end on the very first time it's
// seen. Explicitly labeled a "guess" wherever it's surfaced -- the dispatcher
// always sees the editable Vehicle Type field right there to correct it, and
// a guess is never written to vehicle_type_cache (that stays reserved for
// NHTSA-confirmed results so a bad guess can't propagate).
const MODEL_TYPE_HINTS: [RegExp, VehicleType][] = [
  [/\b(f-?150|f-?250|f-?350|f-?450|silverado|sierra|tacoma|tundra|ram ?1500|ram ?2500|ram ?3500|ranger|colorado|canyon|frontier|titan|ridgeline|maverick|gladiator)\b/, "truck"],
  [/\b(sienna|odyssey|pacifica|voyager|carnival|sedona|transit|sprinter|promaster|express|savana|town ?& ?country)\b/, "van"],
  // Lexus alphanumeric trims (rx450h, nx300, gx460, ux200) never have a word
  // boundary between the letters and the trim digits, so these get their own
  // digit-suffixed pattern instead of the trailing \b the rest share.
  [/\b(rx|nx|gx|ux)\d/, "suv"],
  [/\b(lx450|lx570|lx600|rav4|highlander|4runner|land ?cruiser|cr-?v|hr-?v|pilot|passport|explorer|expedition|escape|edge|bronco|equinox|traverse|tahoe|suburban|trailblazer|blazer|rogue|murano|pathfinder|armada|kicks|santa ?fe|tucson|palisade|sportage|sorento|telluride|cx-5|cx-9|cx-30|outback|forester|ascent|crosstrek|wrangler|grand ?cherokee|cherokee|compass|renegade|x1|x3|x5|x7|q3|q5|q7|q8|glc|gle|gls|xc40|xc60|xc90|model ?x|model ?y)\b/, "suv"],
  [/\b(mustang|camaro|challenger|corvette|\b86\b|brz|miata|mx-5|supra|z4|gt86)\b/, "coupe"],
  // Common JDM grey-market imports (25-year rule) -- a real share of what
  // ships through West Coast ports like Long Beach/Wilmington, so worth
  // covering by name even though NHTSA's own body-class data is thin or
  // absent for these once they're re-titled in the US.
  [/\b(skyline|gt-?r|silvia|s13|s14|s15|soarer|rx-?7|fd3s|fc3s|fairlady|300zx|350z|370z|nsx|integra|ae86|levin|trueno)\b/, "coupe"],
  [/\b(chaser|mark ?ii|mark ?x|cresta|laurel|cefiro|crown|celsior|altezza)\b/, "sedan"],
  [/\b(yaris|fit|fiesta|spark|mirage|versa|rio|accent|soul|leaf|bolt|model ?3)\b/, "small"],
  [/\b(camry|corolla|accord|civic|altima|sentra|maxima|malibu|impala|fusion|taurus|charger|300|elantra|sonata|optima|forte|k5|jetta|passat|\ba3\b|\ba4\b|\ba6\b|3 ?series|5 ?series|c-class|e-class|s-class|model ?s|prius)\b/, "sedan"],
]

function guessVehicleTypeFromModel(make: string | null | undefined, model: string | null | undefined): VehicleType | null {
  const text = `${make || ""} ${model || ""}`.toLowerCase()
  for (const [pattern, type] of MODEL_TYPE_HINTS) if (pattern.test(text)) return type
  return null
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

    let vehicle_type = mapBodyClassToVehicleType(decoded.bodyClass);
    let guessed = false;
    if (!vehicle_type) {
      vehicle_type = guessVehicleTypeFromModel(decoded.make, decoded.model);
      guessed = !!vehicle_type;
    }

    if (decoded.make && decoded.model && decoded.year && vehicle_type && !guessed) {
      // NHTSA-confirmed -- always wins the cache slot, even over an earlier
      // manual (dispatcher-guessed) entry for the same make/model/year.
      await supabase.from("vehicle_type_cache")
        .upsert(
          { make: decoded.make, model: decoded.model, year: decoded.year, body_class: decoded.bodyClass, vehicle_type, source: "nhtsa" },
          { onConflict: "make,model,year" },
        );
    }

    return json({
      manual_required: !vehicle_type,
      guessed,
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

  const guess = guessVehicleTypeFromModel(make, model);
  if (guess) {
    return json({ manual_required: false, guessed: true, year, make, model, vehicle_type: guess });
  }

  return json({
    manual_required: true,
    year, make, model,
    reason: "Haven't seen this year/make/model before — pick the vehicle type.",
  });
});
