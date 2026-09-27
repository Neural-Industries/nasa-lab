# Product

<!-- impeccable:product-schema 1 -->

> Interview skipped at the owner's explicit instruction ("do not ask any further questions").
> Facts marked *(inferred)* come from the brief alone and should be confirmed or corrected.

## Platform

web

## Stack

delegated: Vite + vanilla ES modules + Three.js (WebGL, custom GLSL, post-processing), satellite.js (SGP4),
Web Audio / Web Speech / Geolocation / Fullscreen APIs, and a small Node + Express gateway that holds the
NASA API key server-side, caches every upstream on disk and serves stale data when an upstream fails.
Chosen because the brief asks for "every technology that will allow the application to wow users" and
because most NASA endpoints either lack CORS or share a tight hourly quota.

## Users

*(inferred)* Curious non-specialists — space fans, students, teachers, people who share cool things — plus
developers evaluating what NASA's open APIs can do. They arrive to be amazed first and to learn second,
usually on a laptop or phone, often in the evening.

## Product Purpose

NASA Lab turns the whole api.nasa.gov catalogue into one continuous, explorable, *live* universe: the real
Earth as photographed yesterday, the satellites overhead right now, this month's solar storms, the rocks
passing us this week, the surfaces of other worlds, and every known exoplanet — each wired to the real
NASA feed rather than illustrated. Success: a first-time visitor says "wait, this is real data?" within
the first minute, and keeps exploring.

## Positioning

*(inferred)* Other NASA API demos show one feed in one card. NASA Lab's mechanism is fusion: many NASA
sources rendered into the same physical 3-D space at the same moment in time (e.g. EONET wildfires on
GIBS imagery under SGP4-propagated satellites, lit by the real sub-solar point, ringed by an aurora whose
strength comes from DONKI's latest Kp).

## Operating Context

Runs locally (`npm run dev`) or as a single Node process (`npm start`). Upstreams: api.nasa.gov (APOD,
NeoWs, DONKI, InSight), EONET, EPIC, GIBS, Exoplanet Archive TAP, Image & Video Library, JPL SSD/CNEOS
(CAD, SBDB, Sentry, Fireball), TLE API, Trek WMTS (Moon, Mars, Vesta), TechTransfer, TechPort, OSDR,
Satellite Situation Center.

## Capabilities and Constraints

- The API key must never reach the browser; NeoWs echoes it in pagination links, so responses are scrubbed.
- DEMO_KEY is limited to 30 req/hour/IP; the gateway caches aggressively so a configured key lasts.
- TechPort's search parameter does not filter; the product shows its recently-updated feed instead.
- Satellite Situation Center was unreachable from the build machine; the product reports its status honestly.
- InSight's weather feed is an archive (mission ended 2022) and must be labelled as such.
- Every number shown comes from a live feed or a published constant; nothing is invented.

## Brand Commitments

- Name: **NASA Lab** (set by the owner, 2026-09-27; replaced "APHELION").
- Interface design language: nasa.gov, pinned by the owner. Use its type, colour and component grammar, but never the NASA insignia or logotype. Keep the "independent project, not affiliated with or endorsed by NASA" disclaimer.

## Evidence on Hand

Only the live NASA data itself. No testimonials, users, press or metrics exist and none may be fabricated.

## Product Principles

1. Real before pretty: every visual is driven by a real feed, and the source is always one click away.
2. One universe, not a dashboard: sources meet in shared space and time.
3. Wonder first, depth on demand: the first viewport amazes; detail unfolds when asked for.
4. Degrade honestly: when a feed is slow or down, say so and keep the rest alive.

## Accessibility & Inclusion

*(inferred)* Respect `prefers-reduced-motion`, keep every function keyboard-reachable, give the 3-D scenes
text equivalents in their panels, and keep sound strictly opt-in.
