# Stitch Canvas Manager

A privacy-first userscript project for making Google Stitch canvases readable at low zoom and applying repeatable, parameter-driven screen layouts.

The implementation is currently in design review. See [the design specification](docs/superpowers/specs/2026-08-06-stitch-canvas-userscript-design.md).

This public repository contains no project-specific layouts, screenshots, identifiers, screen names, or account data.

Version 0.3.0 adds local, non-destructive cleanup guardrails. `Alt+L` can inventory minimal canvas metadata, store project-scoped protected screen IDs with a role (`final`, `reference`, `canonical`, or `approved`), persist a minimal cleanup baseline across refreshes, preview exact-ID cleanup candidates, locate them, and verify a native Stitch cleanup. It does not expose a delete action.

Inventory returns only ID, role/type, hidden state, position, dimensions, and a safe screen title from React Flow metadata or explicit title chrome. The title resolver may access only the narrow `source.screen.title` metadata path; it does not traverse, retain, or export the rest of a source payload. It never reads a card's full text, prompt, URL, filename, screenshot, or account data. Titles are never mutation instructions: use exact IDs for cleanup and layout operations.
