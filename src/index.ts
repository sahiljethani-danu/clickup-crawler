#!/usr/bin/env bun

import { Command } from "commander";
import { ClickUpClient } from "./clickup-client";
import { ClickUpCrawler } from "./crawler";

// Bun automatically loads .env files, no need for dotenv

const program = new Command();

program
    .name("clickup-sync")
    .description("Crawl ClickUp workspace and download all documents as markdown")
    .version("1.0.0")
    .option(
        "-t, --token <token>",
        "ClickUp API token (or set CLICKUP_API_TOKEN env var)"
    )
    .option(
        "-w, --workspace <workspaceId>",
        "ClickUp workspace ID (or set CLICKUP_WORKSPACE_ID env var) - required unless using --list-workspaces"
    )
    .option(
        "-s, --space <spaceId>",
        "ClickUp space ID (or set CLICKUP_SPACE_ID env var). If not provided, crawls all spaces in the specified workspace."
    )
    .option(
        "-o, --output <dir>",
        "Output directory for markdown files",
        "./output"
    )
    .option(
        "--list-workspaces",
        "List all available workspaces and exit"
    )
    .option(
        "--docs",
        "Include documents in export (default: true)"
    )
    .option(
        "--no-docs",
        "Exclude documents from export"
    )
    .option(
        "--tasks",
        "Include tasks and task lists in export (default: false)"
    )
    .option(
        "--no-tasks",
        "Exclude tasks and task lists from export (default: true)"
    )
    .action(async (options) => {
        // Get values from CLI args or environment variables
        const apiToken = options.token || Bun.env.CLICKUP_API_TOKEN;
        const workspaceId = options.workspace || Bun.env.CLICKUP_WORKSPACE_ID;
        const spaceId = options.space || Bun.env.CLICKUP_SPACE_ID;
        const outputDir = options.output || Bun.env.OUTPUT_DIR || "./output";

        if (!apiToken) {
            console.error("❌ Error: API token is required");
            console.error("   Use --token <token> or set CLICKUP_API_TOKEN environment variable");
            process.exit(1);
        }

        if (!workspaceId) {
            console.error("❌ Error: Workspace ID is required");
            console.error("   Use --workspace <workspaceId> or set CLICKUP_WORKSPACE_ID environment variable");
            console.error("   Use --list-workspaces to see available workspaces");
            process.exit(1);
        }

        if (options.listWorkspaces) {
            try {
                const client = new ClickUpClient(apiToken);
                const { teams } = await client.getWorkspaces();

                console.log("\n📋 Available Workspaces and Spaces:\n");
                for (const team of teams) {
                    const { spaces } = await client.getSpaces(team.id);
                    console.log(`  Team: ${team.name} (ID: ${team.id})`);
                    for (const space of spaces) {
                        console.log(`    └─ Space: \x1b[34m${space.name}\x1b[0m (ID: ${space.id})`);
                    }
                    console.log();
                }
                process.exit(0);
            } catch (error) {
                console.error("\n❌ Error listing workspaces:", error);
                process.exit(1);
            }
            return;
        }

        // Validate API token format (ClickUp tokens start with "pk_")
        if (!apiToken.startsWith("pk_")) {
            console.warn("⚠️  Warning: ClickUp API tokens usually start with 'pk_'");
        }

        try {
            const client = new ClickUpClient(apiToken);

            // Determine export options (defaults: docs=true, tasks=false)
            // Commander.js: --docs sets docs=true, --no-docs sets docs=false, undefined means use default
            const includeDocs = options.docs ?? true;
            // Commander.js: --tasks sets tasks=true, --no-tasks sets tasks=false, undefined means use default
            const includeTasks = options.tasks ?? false;

            const crawler = new ClickUpCrawler(client, outputDir);

            // Get workspace info
            const { teams } = await client.getWorkspaces();
            const workspace = teams.find(t => t.id === workspaceId);

            if (!workspace) {
                console.error(`❌ Error: Could not find workspace ${workspaceId}`);
                console.error("   Use --list-workspaces to see available workspaces");
                process.exit(1);
            }

            if (spaceId) {
                // Crawl a specific space
                const { spaces } = await client.getSpaces(workspaceId);
                const space = spaces.find(s => s.id === spaceId);

                if (!space) {
                    console.error(`❌ Error: Could not find space ${spaceId} in workspace ${workspace.name}`);
                    console.error("   Use --list-workspaces to see available spaces");
                    process.exit(1);
                }

                console.log("🚀 Starting ClickUp space crawl...");
                console.log(`   Workspace: ${workspace.name} (${workspaceId})`);
                console.log(`   Space: \x1b[34m${space.name}\x1b[0m (${spaceId})`);
                console.log(`   Output directory: ${outputDir}`);
                console.log(`   Include docs: ${includeDocs ? "yes" : "no"}`);
                console.log(`   Include tasks: ${includeTasks ? "yes" : "no"}`);

                await crawler.crawlSpace(spaceId, space.name, workspaceId, includeDocs, includeTasks);
            } else {
                // Crawl all spaces in the specified workspace
                console.log("🚀 Starting ClickUp workspace crawl...");
                console.log(`   Workspace: ${workspace.name} (${workspaceId})`);
                console.log(`   Output directory: ${outputDir}`);
                console.log(`   Include docs: ${includeDocs ? "yes" : "no"}`);
                console.log(`   Include tasks: ${includeTasks ? "yes" : "no"}`);
                console.log(`   Crawling all spaces in workspace\n`);

                const { spaces } = await client.getSpaces(workspaceId);

                for (const space of spaces) {
                    try {
                        await crawler.crawlSpace(space.id, space.name, workspaceId, includeDocs, includeTasks);
                        // Small delay between spaces to respect rate limits
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (error) {
                        console.error(`  ❌ Error crawling space \x1b[34m${space.name}\x1b[0m: ${error}`);
                        // Continue with next space instead of failing completely
                    }
                }

                console.log("\n✅ Crawl complete!");
            }
        } catch (error) {
            console.error("\n❌ Fatal error:", error);
            process.exit(1);
        }
    });

program.parse();

