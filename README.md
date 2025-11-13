# ClickUp Sync

A Bun TypeScript application that crawls a ClickUp workspace and downloads all documents as markdown files, maintaining the space/document hierarchy.

## Features

- ✅ Crawls all spaces in a ClickUp workspace
- ✅ Downloads all documents with their content
- ✅ Maintains the hierarchical structure (spaces → documents → sub-documents)
- ✅ Converts ClickUp document format to markdown
- ✅ Preserves document relationships and nesting

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
   - Go to your ClickUp workspace
   - The workspace ID is in the URL: `https://app.clickup.com/{workspace_id}/...`
   - Or use the API: `GET https://api.clickup.com/api/v2/team` (requires auth)

## Usage

### CLI Options

```bash
bun start --help
```

### Basic Usage

Run the crawler with CLI arguments:
```bash
bun start --token <your_token> --workspace <workspace_id>
```

Or use environment variables (from `.env` file):
```bash
bun start
```

### List Available Workspaces

To see all available workspaces and their IDs:
```bash
bun start --token <your_token> --list-workspaces
```

### Specify Output Directory

```bash
bun start --token <your_token> --workspace <workspace_id> --output ./my-docs
```

### CLI Options

- `-t, --token <token>` - ClickUp API token (or set `CLICKUP_API_TOKEN` env var)
- `-w, --workspace <workspaceId>` - ClickUp workspace ID (or set `CLICKUP_WORKSPACE_ID` env var)
- `-o, --output <dir>` - Output directory for markdown files (default: `./output`)
- `--list-workspaces` - List all available workspaces and exit
- `-h, --help` - Display help message
- `-V, --version` - Display version number

### Development Mode

Run in watch mode for development:
```bash
bun run dev
```

The application will:
1. Connect to ClickUp API
2. Fetch all spaces in the workspace
3. Download all documents from each space
4. Save them as markdown files in the specified output directory

## Output Structure

Documents are saved maintaining the ClickUp hierarchy:

```
output/
├── Space_Name_1/
│   ├── Document_1.md
│   ├── Document_2/
│   │   ├── Document_2.md
│   │   └── Sub_Document_1.md
│   └── Document_3.md
└── Space_Name_2/
    └── Document_1.md
```

## API Rate Limits

ClickUp API has rate limits:
- 100 requests per minute per API token
- The crawler includes basic error handling, but may need delays for large workspaces

## Troubleshooting

**Error: "API token is required"**
- Provide the token via `--token <token>` CLI argument
- Or set `CLICKUP_API_TOKEN` environment variable
- Or add it to your `.env` file

**Error: "ClickUp API error: 401"**
- Your API token is invalid or expired
- Generate a new token from ClickUp settings

**Error: "ClickUp API error: 404"**
- The workspace ID might be incorrect
- Verify the workspace ID in your ClickUp URL

**Documents are empty or not formatted correctly**
- ClickUp documents use a custom format that may vary
- The converter handles common formats but may need adjustments for edge cases

## License

MIT

