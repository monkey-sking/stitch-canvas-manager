# Stitch Canvas Manager Design

## Problem

Google Stitch screen cards become hard to identify when a large canvas is zoomed out. The public UI and MCP also do not provide every operator action needed for repeatable canvas layout, protected-screen cleanup, or independent cleanup verification.

## Audience

- Designers and product owners using Stitch in a desktop browser.
- Browser agents operating an authenticated, isolated browser session.

The manager is local operator tooling. It does not change screen content or become part of the designed product.

## Version 0.3 Outcome

- Fixed-size screen labels remain readable at low zoom.
- Layout JSON can be exported, validated, applied, and undone by exact React Flow node ID.
- Reference and target screens can be placed side by side with an explicit logical gap.
- Approved and reference screens can be protected by exact ID.
- Cleanup candidates can be previewed and located, but the manager exposes no delete action.
- A minimal cleanup baseline survives a top-level page refresh and can be verified afterward.

## Identity

React Flow node IDs are authoritative for local canvas operations. Screen titles are display metadata only. Titles may be duplicated, changed, or hidden and therefore never authorize layout or cleanup mutations.

An operator integrating with Stitch MCP must explicitly verify the mapping between a React Flow node ID and an MCP screen ID. The manager does not assume they are equal.

## Architecture

The userscript runs inside the Stitch app-companion frame and contains four bounded areas:

1. `NodeRegistry` reads the complete React Flow model for ID, role/type, hidden state, logical position, and measured dimensions. Mounted DOM nodes are used only for labels and visual preview.
2. `LabelOverlay` renders non-interactive fixed-size labels outside the transformed viewport. Script-owned DOM mutations are filtered so the observer does not refresh itself in a loop.
3. `LayoutEngine` validates exact IDs and applies position changes through React Flow's `onNodesChange` callback. Synthetic pointer dragging and raw node-style mutation are not persistence mechanisms.
4. `CleanupGuardrails` stores protected IDs and a minimal baseline, previews exact candidates, temporarily centers a candidate without moving it, restores the viewport, and reports all unexpected changes.

The top-level `stitch.withgoogle.com` wrapper removes duplicate launcher artifacts and leaves canvas operations to the app-companion frame.

## Safe Title Resolution

Title resolution uses the first available value from narrow screen metadata, including `data.source.screen.title`, or explicit title chrome such as `span.truncate`. It never falls back to a whole node's `innerText` or rendered prototype body.

If no safe title exists, the label is `未命名页面`. The fallback is intentionally less informative than leaking prompt or prototype content.

## Layout Flow

1. Export the current layout as an undo/reference snapshot.
2. Supply a schema-versioned layout with the matching project ID and exact node IDs.
3. Validate all IDs and coordinates before mutation. Any unknown ID blocks the whole application.
4. Apply changed positions through `onNodesChange` with `dragging: false`.
5. Read the resulting logical positions back and fail if any changed node is outside tolerance.
6. Use one-level undo if the result is wrong.

The manager never persists a layout document automatically. Exported layout JSON can contain project-specific IDs, titles, and coordinates, so it remains local and uncommitted unless the operator deliberately stores it in a private artifact.

## Cleanup Flow

1. Capture an independent Stitch screen-list baseline.
2. Capture the full React Flow inventory, including hidden state.
3. Protect approved, canonical, and reference nodes by exact ID.
4. Create and preview an exact-ID candidate plan. Unknown or protected IDs block the plan.
5. Use Stitch's native Delete action manually and individually.
6. Refresh the top-level Stitch page.
7. Restore the project-scoped plan and verify:
   - selected candidates are hidden or absent;
   - plan-time and current protected IDs remain visible;
   - originally visible non-candidates did not disappear;
   - originally hidden nodes did not become visible;
   - no unexpected node was added.
8. Independently verify the final visible screen list through Stitch UI or MCP.

Stitch native Delete currently means soft-hide (`hidden: true`). It is not permanent asset deletion. The manager exposes no delete API and does not call undocumented Stitch endpoints.

## Local Storage

Tampermonkey storage is project-scoped and limited to:

- protected node ID and role;
- cleanup candidate IDs;
- uncertain candidate IDs;
- plan-time protected IDs;
- baseline node ID and hidden state;
- plan timestamp.

The manager does not persist titles, positions, prompts, URLs, screenshots, files, cookies, browser profiles, or account data. It sends no telemetry and requests no cross-origin network permission.

## Public Repository Boundary

The public repository may contain source, tests, generic documentation, fabricated fixtures, and release metadata. It must not contain real project IDs, screen names, canvas screenshots, layout exports, authenticated browser data, local planning notes, credentials, personal paths, or account information.

## Error Handling

- Async canvas load: install observers and retry discovery without aborting boot.
- Unsupported React Flow shape: show a concise compatibility state and do not mutate.
- Unknown or protected candidate ID: block preview, locate, and verification.
- Project mismatch or invalid coordinate: block the entire layout application.
- Locate fallback: temporarily change only the viewport transform, then restore it if React has not replaced it.
- Unexpected cleanup change: report visible candidate, protected loss, unexpected loss, unexpected addition, and visibility change counts separately.

## Verification

Automated checks cover:

- userscript syntax and metadata;
- no telemetry or delete-like public API;
- safe title metadata and no whole-node text fallback;
- exact-ID-only mutation paths;
- plan-time protected-screen enforcement;
- pre-hidden baseline handling;
- unexpected additions and hidden-to-visible changes;
- minimal cleanup-plan persistence shape;
- transformed-canvas locate fallback and viewport restore hooks.

Browser verification uses a real Stitch project but performs no deletion or node movement. It must confirm full inventory, protection rejection, plan restoration, preview marking, exact candidate location, viewport restoration, verification counts, and rejection of title/unknown-ID mutations.
