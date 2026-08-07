# Installation

## Tampermonkey

1. Install Tampermonkey in the browser you use for Stitch.
2. Open the raw userscript URL from GitHub:
   `https://raw.githubusercontent.com/monkey-sking/stitch-canvas-manager/main/src/stitch-canvas-manager.user.js`
3. Install the script and open a Stitch project.
4. Press `Alt+L` to open the local operator panel. Labels are enabled by default.

The same script can run in a normal browser and in ego-browser if Tampermonkey is available there. It stores settings locally and does not send project data anywhere.

## Safe Cleanup Workflow

1. Open `Alt+L` and use `查看保护` to review the project-local protection list.
2. Add protected entries as `full-screen-id,role`, where role is `final`, `reference`, `canonical`, or `approved`.
3. Enter only full screen IDs as cleanup candidates and select `预览候选`.
4. Use `定位下一个` to inspect each highlighted candidate in Stitch. The script cannot delete anything.
5. Use Stitch's native Delete action only after checking the preview. Native Delete currently soft-hides a screen; it does not permanently erase the asset.
6. Refresh the top-level Stitch project page, reopen `Alt+L`, and use `载入计划` if the saved candidate list is not already shown.
7. Select `验证清理`. A hidden or absent candidate counts as no longer visible; protected screens must remain visible, and unexpected additions, removals, or visibility changes must all remain zero.
8. Independently confirm the visible screen list with the official Stitch UI or MCP before treating cleanup as complete.

The manager stores only protected ID/role plus a project-scoped cleanup plan containing candidate IDs, uncertain IDs, protected IDs, baseline ID/hidden state, and a timestamp. It does not persist titles, coordinates, prompts, screenshots, or account data. Do not add project data to this repository or use title matching as a mutation instruction.

## Layout JSON

Use **Export layout** to create a project-specific JSON file locally. Do not commit real project IDs, screen names, screenshots, or coordinates to this public repository.
