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
        "-s, --space <spaceId>",
        "ClickUp space ID (or set CLICKUP_SPACE_ID env var). If not provided, crawls all spaces in all workspaces."
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
    .action(async (options) => {
        // Get values from CLI args or environment variables
        const apiToken = options.token || Bun.env.CLICKUP_API_TOKEN;
        const spaceId = options.space || Bun.env.CLICKUP_SPACE_ID;
        const outputDir = options.output || Bun.env.OUTPUT_DIR || "./output";

        if (!apiToken) {
            console.error("❌ Error: API token is required");
            console.error("   Use --token <token> or set CLICKUP_API_TOKEN environment variable");
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
                        console.log(`    └─ Space: ${space.name} (ID: ${space.id})`);
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
            const crawler = new ClickUpCrawler(client, outputDir);

            if (spaceId) {
                // Crawl a specific space
                // Get workspace ID and space name - we need workspaceId for v3 API
                // Spaces belong to workspaces, so we need to find which workspace contains this space
                let workspaceId: string | undefined;
                let spaceName: string = "Space";

                const { teams } = await client.getWorkspaces();

                // Search through all workspaces to find which one contains this space
                for (const team of teams) {
                    try {
                        const { spaces } = await client.getSpaces(team.id);
                        const space = spaces.find(s => s.id === spaceId);
                        if (space) {
                            workspaceId = team.id;
                            spaceName = space.name;
                            break;
                        }
                    } catch {
                        continue;
                    }
                }

                if (!workspaceId) {
                    console.error(`❌ Error: Could not find workspace containing space ${spaceId}`);
                    console.error("   Use --list-workspaces to see available spaces");
                    process.exit(1);
                }

                console.log("🚀 Starting ClickUp space crawl...");
                console.log(`   Space: ${spaceName} (${spaceId})`);
                console.log(`   Workspace ID: ${workspaceId}`);
                console.log(`   Output directory: ${outputDir}`);

                await crawler.crawlSpace(spaceId, spaceName, workspaceId);
            } else {
                // Crawl all spaces in all workspaces
                console.log("🚀 Starting ClickUp workspace crawl...");
                console.log(`   Output directory: ${outputDir}`);
                console.log(`   Crawling all spaces in all workspaces\n`);

                const { teams } = await client.getWorkspaces();

                for (const team of teams) {
                    try {
                        const { spaces } = await client.getSpaces(team.id);
                        console.log(`\n📁 Workspace: ${team.name} (${team.id})`);

                        for (const space of spaces) {
                            try {
                                await crawler.crawlSpace(space.id, space.name, team.id);
                                // Small delay between spaces to respect rate limits
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            } catch (error) {
                                console.error(`  ❌ Error crawling space ${space.name}: ${error}`);
                                // Continue with next space instead of failing completely
                            }
                        }
                    } catch (error) {
                        console.error(`❌ Error fetching spaces for workspace ${team.name}: ${error}`);
                        // Continue with next workspace
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

