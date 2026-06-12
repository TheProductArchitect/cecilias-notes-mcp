# cecilias-notes-mcp

MCP server for [Cecilia's Notes](https://venugopinath.me/cecilias-notes) — lets any
MCP-compatible AI agent create and read notebooks that appear on your
iPad via iCloud sync.

## How it works

The MCP server runs on your Mac and reads and writes `.inkbook` JSON files
in the Cecilia's Notes iCloud ubiquity container. iCloud syncs them to
your iPad. The app reads them and displays them as notebooks.

No backend. No API keys. No account. Your notes never leave your devices.

### Two-directory design

The container has two directories the MCP uses:

| Directory | Purpose |
|---|---|
| `…/Documents/Inbox/` | **MCP writes here.** Create / append / delete-request files land here; the app watches Inbox with `NSMetadataQuery` and processes every new file. |
| `…/Documents/MCP/notebooks/` | **MCP reads here.** The app exports a mirror `.inkbook` file (named `<uuid>.inkbook`) for every live notebook so the MCP can list, read, append, and search without touching the app's SwiftData. |

Both directories must exist; `cecilias-notes-mcp-setup` creates them.

Full path on macOS:

```
~/Library/Mobile Documents/iCloud~app~ceciliasnotes/Documents/
  ├── Inbox/                  ← MCP writes
  └── MCP/notebooks/          ← MCP reads
```

## Requirements

- macOS (any recent version)
- iCloud Drive enabled
- Cecilia's Notes installed on your iPad, signed in to the same Apple ID
- Node.js 18+
- Claude Desktop or any MCP-compatible client

## Installation

```
npm install -g cecilias-notes-mcp
cecilias-notes-mcp-setup
```

Restart Claude Desktop. Done.

## Manual setup

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cecilias-notes": {
      "command": "cecilias-notes-mcp"
    }
  }
}
```

## Block vocabulary

Notebooks are made of pages; pages are arrays of typed blocks. The iPad
renderer styles each type natively — agents should use the structural
forms rather than collapsing prose into one paragraph.

| Block | Shape | Use it for |
|---|---|---|
| `heading` | `{ type, content, level: 1\|2\|3 }` | Section titles |
| `paragraph` | `{ type, content }` | Body prose (split at logical breaks) |
| `list` | `{ type, style: "bullet"\|"numbered", items: [...] }` | 3+ parallel items |
| `code` | `{ type, content, language? }` | Monospaced code or terminal output |
| `quote` | `{ type, content, attribution? }` | Citing a person or source |
| `callout` | `{ type, content, kind: "note"\|"warning"\|"tip" }` | Short emphasised aside |
| `divider` | `{ type }` | Visual break between sections |

## Tools

### `create_notebook`

Create a new notebook. Generates an uppercase UUID, writes the file to
Inbox under a title-based filename (with a numeric suffix if a file by
that name already exists).

**Input**
```jsonc
{
  "title": "Coffee Shops",          // required
  "subject": "Research",            // required ("" for uncategorised)
  "pages": [ [ /* blocks */ ] ],    // required, at least one page
  "cover_tone": "parchment",        // optional
  "page_template": "blank",         // optional. Omit → app default (blank).
                                    // "blank" | "lined" | "grid" | "dot-grid" | "cornell" | "music"
  "page_size": "a4",                // optional, default: "a4"
  "model": "claude-opus-4"          // optional, attributed in the app
}
```

**Returns** `{ success, notebook_id, title, subject, pages, file, message }`

### `append_to_notebook`

Append pages to an existing notebook. Reads from the MCP mirror, appends,
re-indexes pages from 0, writes back to `Inbox/<notebook_id>.inkbook`. The
app dedupes by id and replaces pages wholesale.

**Input**
```jsonc
{
  "notebook_id": "<uuid>",          // required
  "pages": [ [ /* blocks */ ] ]     // required, at least one page
}
```

**Returns** `{ success, notebook_id, pages_added, total_pages, appended_page_indices, file, message }`

> 📐 **Block fidelity.** As of the iPad app's v1.2 importer, mirrored
> notebooks preserve their original block structure, and `append_to_notebook`
> merges by page id — existing pages keep their blocks, only the new pages
> this call adds are inserted. Write new pages using the full block
> vocabulary; don't collapse content into a single paragraph.

### `list_notebooks`

List the notebooks in the MCP mirror. Returns summaries only — no page content.

**Input**
```jsonc
{ "subject": "Research" }   // optional, case-insensitive
```

**Returns** `{ count, notebooks: [ { id, title, subject, created_at, updated_at, page_count, page_size, page_template, agent } ] }`

### `read_notebook`

Read the full content of a notebook from the MCP mirror.

**Input**
```jsonc
{ "notebook_id": "<uuid>" }
```

**Returns** the complete `.inkbook` object with all pages and blocks.

### `search_notes`

Substring search across titles and block content of every notebook in the
MCP mirror. Returns the page indices where each match occurred.

**Input**
```jsonc
{
  "query": "morocco",       // required
  "subject": "Travel"       // optional
}
```

**Returns** `{ query, subject, count, results: [ { notebook_id, title, subject, title_match, matching_pages: [ { index, preview } ] } ] }`

### `delete_notebook`

Submit a soft-delete request. Writes
`Inbox/delete_notebook_request_<uuid>.json` containing
`{ "action": "delete_notebook", "notebook_id": "<uuid>" }`. The app
processes the request asynchronously and removes the MCP mirror. The user
can recover the notebook from the app for 30 days.

**Input**
```jsonc
{ "notebook_id": "<uuid>" }
```

**Returns** `{ success, notebook_id, request_file, message }`

## The .inkbook format

Notebooks are stored as JSON files with the `.inkbook` extension.
The format spec is open: https://venugopinath.me/cecilias-notes/schemas/inkbook/v1.json

## Example usage

In Claude Desktop after setup:

> "Research the best coffee shops near Cambridge Judge Business School
> and save the results to a notebook called Coffee Shops in my Research subject."

> "Summarise my last three meetings and append a digest page to my Weekly Brief notebook."

> "Search my notes for anything about Morocco and give me a summary."

## License

MIT. Open source. Audit it, fork it, contribute.
