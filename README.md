# ClickUp Sync

A Bun TypeScript application that crawls a ClickUp workspace and downloads documents as markdown files and tasks/task lists as CSV files, maintaining the space/document hierarchy.

## Features

- ✅ Crawls all spaces in a ClickUp workspace (or a specific space)
- ✅ Downloads all documents with their content as markdown
- ✅ Exports tasks and task lists as CSV files with all available fields
- ✅ Maintains the hierarchical structure (spaces → documents → sub-documents)
- ✅ Converts ClickUp document format to markdown
- ✅ Preserves document relationships and nesting
- ✅ Memory-efficient CSV export (writes incrementally, doesn't keep all tasks in memory)
- ✅ Uses bulk APIs when possible to minimize API calls
- ✅ Rate limit detection and progress logging

## Prerequisites

- [Bun](https://bun.sh) installed on your system
- A ClickUp API token
- Your ClickUp workspace ID

## Setup

1. **Install dependencies:**
   ```bash
   bun install
   ```

2. **Configure environment variables:**
   
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your credentials:
   ```env
   CLICKUP_API_TOKEN=pk_your_api_token_here
   CLICKUP_WORKSPACE_ID=your_workspace_id_here
   OUTPUT_DIR=./output
   ```

3. **Get your ClickUp API token:**
   - Go to [ClickUp Settings](https://app.clickup.com/settings/apps)
   - Navigate to "Apps" → "API"
   - Click "Generate" to create a new API token
   - Copy the token (starts with `pk_`)

4. **Find your Workspace ID:**
   - Use the built-in command: `bun start --list-workspaces`
   - Or go to your ClickUp workspace and find the ID in the URL: `https://app.clickup.com/{workspace_id}/...`

## Usage

### Basic Usage

**Crawl all spaces in a workspace (docs only, default):**
```bash
bun start --workspace <workspace_id>
```

**Crawl a specific space:**
```bash
bun start --workspace <workspace_id> --space <space_id>
```

**Include tasks and task lists:**
```bash
bun start --workspace <workspace_id> --tasks
```

**Tasks only (no documents):**
```bash
bun start --workspace <workspace_id> --no-docs --tasks
```

**Use environment variables:**
```bash
bun start
```

### List Available Workspaces

To see all available workspaces and their space IDs:
```bash
bun start --list-workspaces
```

### CLI Options

- `-t, --token <token>` - ClickUp API token (or set `CLICKUP_API_TOKEN` env var)
- `-w, --workspace <workspaceId>` - **Required** ClickUp workspace ID (or set `CLICKUP_WORKSPACE_ID` env var)
- `-s, --space <spaceId>` - **Optional** ClickUp space ID (or set `CLICKUP_SPACE_ID` env var). If not provided, crawls all spaces in the workspace.
- `-o, --output <dir>` - Output directory for files (default: `./output`)
- `--docs` - Include documents in export (default: `true`)
- `--no-docs` - Exclude documents from export
- `--tasks` - Include tasks and task lists in export (default: `false`)
- `--no-tasks` - Exclude tasks and task lists from export
- `--list-workspaces` - List all available workspaces and exit
- `-h, --help` - Display help message
- `-V, --version` - Display version number

### Examples

**Export everything (docs + tasks) from all spaces:**
```bash
bun start --workspace <workspace_id> --tasks
```

**Export only tasks from a specific space:**
```bash
bun start --workspace <workspace_id> --space <space_id> --no-docs --tasks
```

**Export only documents (default behavior):**
```bash
bun start --workspace <workspace_id>
```

**Custom output directory:**
```bash
bun start --workspace <workspace_id> --output ./my-docs
```

### Development Mode

Run in watch mode for development:
```bash
bun run dev
```

## Output Structure

### Documents (Markdown)

Documents are saved maintaining the ClickUp hierarchy:

```
output/
├── Space_Name_1/
│   ├── Document_1/
│   │   ├── Page_1.md
│   │   └── Page_2.md
│   └── Document_2.md
└── Space_Name_2/
    └── Document_1.md
```

### Tasks and Task Lists (CSV)

Tasks and task lists are exported as CSV files in each space directory:

```
output/
├── Space_Name_1/
│   ├── tasks.csv          # All tasks with all available fields
│   └── task_lists.csv     # All task lists with all available fields
└── Space_Name_2/
    ├── tasks.csv
    └── task_lists.csv
```

The CSV files include:
- **tasks.csv**: All tasks from all lists in the space, with all available fields including subtasks, descriptions, assignees, due dates, custom fields, etc.
- **task_lists.csv**: All task lists (both in folders and directly in the space) with all available metadata

CSV files are written incrementally to minimize memory usage, making it efficient for workspaces with thousands of tasks.

## API Rate Limits & Performance

ClickUp API has rate limits:
- 100 requests per minute per API token
- The crawler includes:
  - Automatic rate limit detection and logging
  - Progress tracking when rate limited
  - Bulk API usage when possible (fetches all tasks from a list at once)
  - Smart fetching (only fetches individual task details when needed)
  - Delays between requests to respect rate limits

If you encounter rate limiting, the crawler will log the current progress and continue processing.

## Troubleshooting

**Error: "API token is required"**
- Provide the token via `--token <token>` CLI argument
- Or set `CLICKUP_API_TOKEN` environment variable
- Or add it to your `.env` file

**Error: "Workspace ID is required"**
- Workspace ID is now required (space is optional)
- Provide it via `--workspace <workspace_id>` CLI argument
- Or set `CLICKUP_WORKSPACE_ID` environment variable
- Use `--list-workspaces` to see available workspaces

**Error: "ClickUp API error: 401"**
- Your API token is invalid or expired
- Generate a new token from ClickUp settings

**Error: "ClickUp API error: 404"**
- The workspace ID might be incorrect
- Use `--list-workspaces` to verify the workspace ID

**Error: "ClickUp API error: 429" (Rate Limited)**
- The crawler will automatically log progress and continue
- Consider running during off-peak hours for large workspaces
- The crawler includes delays to respect rate limits

**Documents are empty or not formatted correctly**
- ClickUp documents use a custom format that may vary
- The converter handles common formats but may need adjustments for edge cases

**CSV files are incomplete**
- Check the console for rate limit warnings
- The crawler continues processing even if some tasks fail
- Re-run the sync to catch any missed items

## License

MIT
