# ChatGPT coding workflow

1. Open a workspace with `open_workspace` once per project folder.
2. Reuse the returned `workspaceId` for every follow-up file, shell, and change-card call.
3. Read loaded `AGENTS.md` or nested instruction files before editing under those paths.
4. Prefer targeted edits for existing files and full writes only for new files or complete rewrites.
5. Run tests or builds after a coherent set of edits.
6. Call `show_changes` so the user can inspect the aggregate diff.

This fork also supports persistent workspace sessions, SSH workspaces, and the legacy `review_changes` alias for older clients.
