# loupe

<img src="web/favicon.svg" alt="" width="96" height="96">

A browser workbench for reading what coding agents write: files, diffs, terminals, Git and search.
Like a loupe, it is for looking closely, not for writing: there is no project-wide language server.

## Run

Use `npm run dev` for development (open port 5173), or `npm run build && npm start -- /path/to/project` for production (open port 4100).

## Open a project from the URL

Append the project's absolute path on the server to the address:

```text
http://localhost:4100/Users/me/code/app
```

The code-server-style query parameter is also supported and takes precedence over the URL path:

```text
http://localhost:4100/?folder=/Users/me/code/app
```

Use port 5173 in development. Visiting `/` without `folder` opens the directory passed at startup, or the server's working directory. Paths refer to the machine running loupe. URL-encode reserved characters such as `#`, `?`, `%` and `&` when they appear in folder names.

Each project has its own files, Git state, search and terminals. A project can be open in only one window at a time, including when opened through a symlink. Opening it in another window moves it there, and the old window offers to take it back. Sessions stay alive until the server stops, so refreshing or returning to a project restores its running terminals. Invalid directories show an error with a link back to the default workspace.

## Source notes

Notes for `glue/crates/glue/src/lib.rs` are read from `.agents/glue/crates/glue/src/lib.rs.md` in the workspace. Use `## L12-30` headings to anchor each section to source lines. Open the source file to see its notes beside the editor or diff. Files inside `.agents` do not display additional notes.

## Check

Run `npm run check` for type checks. After building the app, run `node --test server/main.test.ts` for workspace integration tests (requires Git, ripgrep and a working shell).
