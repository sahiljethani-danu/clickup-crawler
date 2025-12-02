import { ClickUpClient, ClickUpDocument, ClickUpList } from "./clickup-client";
import { mkdir, writeFile, appendFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { objectsToCSV, objectToCSVRow, getFieldNames, escapeCSV } from "./csv-utils";

interface ClickUpPage {
  id: string;
  name: string;
  content: string;
  parent_id?: string | null;
  date_created: number;
  date_updated: number;
}

interface DocumentNode {
  id: string;
  name: string;
  type: string;
  content: string;
  children: DocumentNode[];
  parentId: string | null;
  pages?: ClickUpPage[];
}

export class ClickUpCrawler {
  private client: ClickUpClient;
  private outputDir: string;

  constructor(client: ClickUpClient, outputDir: string) {
    this.client = client;
    this.outputDir = outputDir;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private sanitizeFileName(name: string): string {
    // Remove invalid characters for file names
    return name
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .replace(/_{2,}/g, "_")
      .trim();
  }

  private async ensureDirectory(path: string): Promise<void> {
    if (!existsSync(path)) {
      await mkdir(path, { recursive: true });
    }
  }

  private async savePage(
    page: ClickUpPage,
    basePath: string,
    documentName: string
  ): Promise<void> {
    const fileName = this.sanitizeFileName(page.name || 'Untitled Page');
    const filePath = join(basePath, `${fileName}.md`);

    // Create markdown content
    let markdown = `# ${page.name || 'Untitled Page'}\n\n`;

    if (page.content && page.content.trim() !== '') {
      markdown += page.content;
    } else {
      markdown += `> ⚠️ **Note**: This page has no content.\n`;
    }

    await writeFile(filePath, markdown, "utf-8");
    console.log(`  Saved page: ${filePath}`);
  }

  private async saveDocument(
    node: DocumentNode,
    basePath: string,
    spaceName: string
  ): Promise<void> {
    // Create a directory for this document
    const docDirName = this.sanitizeFileName(node.name);
    const docPath = join(basePath, docDirName);
    await this.ensureDirectory(docPath);

    // Save each page as a separate file
    if (node.pages && node.pages.length > 0) {
      // Build page tree to handle sub-pages
      const pageMap = new Map<string, ClickUpPage>();
      const rootPages: ClickUpPage[] = [];

      // First pass: create map of all pages
      for (const page of node.pages) {
        pageMap.set(page.id, page);
      }

      // Second pass: identify root pages (pages without parents or with parent_id pointing to document)
      for (const page of node.pages) {
        if (!page.parent_id || page.parent_id === node.id) {
          rootPages.push(page);
        }
      }

      // Save root pages and their sub-pages recursively
      for (const rootPage of rootPages) {
        await this.savePage(rootPage, docPath, node.name);

        // Find and save sub-pages
        const subPages = node.pages.filter(p => p.parent_id === rootPage.id);
        if (subPages.length > 0) {
          // Create subdirectory for sub-pages
          const subDirName = this.sanitizeFileName(rootPage.name);
          const subDirPath = join(docPath, subDirName);
          await this.ensureDirectory(subDirPath);

          for (const subPage of subPages) {
            await this.savePage(subPage, subDirPath, rootPage.name);
          }
        }
      }

      // Also save any pages that weren't root pages and weren't sub-pages of root pages
      // (in case there are orphaned pages or deeper nesting)
      const savedPageIds = new Set<string>();
      rootPages.forEach(p => savedPageIds.add(p.id));
      rootPages.forEach(rootPage => {
        const subPages = (node.pages || []).filter(p => p.parent_id === rootPage.id);
        subPages.forEach(sp => savedPageIds.add(sp.id));
      });

      const orphanedPages = (node.pages || []).filter(p => !savedPageIds.has(p.id));
      for (const orphanedPage of orphanedPages) {
        // Try to find its parent and save it in the appropriate location
        if (orphanedPage.parent_id && pageMap.has(orphanedPage.parent_id)) {
          const parentPage = pageMap.get(orphanedPage.parent_id)!;
          const parentDirName = this.sanitizeFileName(parentPage.name);
          const parentDirPath = join(docPath, parentDirName);
          await this.ensureDirectory(parentDirPath);
          await this.savePage(orphanedPage, parentDirPath, parentPage.name);
        } else {
          // Save as root page if parent not found
          await this.savePage(orphanedPage, docPath, node.name);
        }
      }
    } else {
      // No pages, create an empty document file
      const fileName = this.sanitizeFileName(node.name);
      const filePath = join(basePath, `${fileName}.md`);
      const markdown = `# ${node.name}\n\n> ⚠️ **Note**: This document has no pages.\n`;
      await writeFile(filePath, markdown, "utf-8");
      console.log(`Saved: ${filePath}`);
    }
  }

  private convertToMarkdown(content: any): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => this.convertToMarkdown(item))
        .join("\n\n");
    }

    if (typeof content === "object" && content !== null) {
      // Handle ClickUp document structure
      if (content.type === "doc" && content.content) {
        return this.convertToMarkdown(content.content);
      }

      if (content.type === "paragraph" && content.content) {
        return this.convertToMarkdown(content.content) + "\n";
      }

      if (content.type === "heading") {
        const level = content.attrs?.level || 1;
        const text = this.extractText(content);
        return `${"#".repeat(level)} ${text}\n`;
      }

      if (content.type === "bulletList" || content.type === "orderedList") {
        return this.convertList(content);
      }

      if (content.type === "listItem") {
        return `- ${this.extractText(content)}\n`;
      }

      if (content.type === "text") {
        let text = content.text || "";
        if (content.marks) {
          for (const mark of content.marks) {
            if (mark.type === "bold") {
              text = `**${text}**`;
            } else if (mark.type === "italic") {
              text = `*${text}*`;
            } else if (mark.type === "code") {
              text = `\`${text}\``;
            } else if (mark.type === "link") {
              text = `[${text}](${mark.attrs?.href || ""})`;
            }
          }
        }
        return text;
      }

      if (content.content) {
        return this.convertToMarkdown(content.content);
      }
    }

    return String(content);
  }

  private extractText(node: any): string {
    if (typeof node === "string") {
      return node;
    }

    if (node.text) {
      return node.text;
    }

    if (Array.isArray(node.content)) {
      return node.content.map((item: any) => this.extractText(item)).join("");
    }

    if (node.content) {
      return this.extractText(node.content);
    }

    return "";
  }

  private convertList(node: any): string {
    if (!node.content || !Array.isArray(node.content)) {
      return "";
    }

    return node.content
      .map((item: any) => {
        if (item.type === "listItem" && item.content) {
          const text = item.content
            .map((c: any) => this.extractText(c))
            .join(" ");
          return `- ${text}`;
        }
        return "";
      })
      .filter((s: string) => s)
      .join("\n");
  }

  private buildDocumentTree(documents: ClickUpDocument[]): DocumentNode[] {
    // Create a map of all documents
    const nodeMap = new Map<string, DocumentNode>();

    // First pass: create all nodes
    for (const doc of documents) {
      const node: DocumentNode = {
        id: doc.id,
        name: doc.name,
        type: doc.type,
        content: doc.content || "",
        children: [],
        parentId: doc.parent?.id || null,
      };
      nodeMap.set(doc.id, node);
    }

    // Second pass: build tree structure
    const rootNodes: DocumentNode[] = [];
    for (const [id, node] of nodeMap) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        const parent = nodeMap.get(node.parentId)!;
        parent.children.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    return rootNodes;
  }

  private async processDocumentNode(
    node: DocumentNode,
    basePath: string,
    spaceName: string
  ): Promise<void> {
    const dirName = this.sanitizeFileName(node.name);

    if (node.children.length > 0) {
      // Document has children: save the document itself, then create a subdirectory for children
      await this.saveDocument(node, basePath, spaceName);

      // Create subdirectory for children
      const childrenPath = join(basePath, dirName);
      await this.ensureDirectory(childrenPath);

      // Process children in the subdirectory
      for (const child of node.children) {
        await this.processDocumentNode(child, childrenPath, spaceName);
      }
    } else {
      // Leaf node, save as markdown file
      await this.saveDocument(node, basePath, spaceName);
    }
  }

  /**
   * Export tasks organized by their folder/list structure
   * Each list gets its own CSV file in the appropriate folder
   */
  private async exportTasksByFolder(spaceId: string, spacePath: string, spaceName: string): Promise<void> {
    try {
      console.log(`  Fetching task lists and tasks...`);
      let totalTasks = 0;
      let totalLists = 0;

      // Structure to hold lists by folder
      interface ListWithFolder {
        list: ClickUpList;
        folderName: string | null;
        folderId: string | null;
      }

      const listsWithFolders: ListWithFolder[] = [];

      // Get lists directly in space (no folder)
      try {
        const { lists: spaceLists } = await this.client.getListsInSpace(spaceId);
        for (const list of spaceLists) {
          listsWithFolders.push({
            list,
            folderName: null,
            folderId: null
          });
        }
      } catch (error) {
        console.error(`  Error fetching space lists: ${error}`);
      }

      // Get lists in folders
      try {
        const { folders } = await this.client.getFolders(spaceId);
        for (const folder of folders) {
          try {
            const { lists } = await this.client.getLists(folder.id);
            for (const list of lists) {
              listsWithFolders.push({
                list,
                folderName: folder.name,
                folderId: folder.id
              });
            }
          } catch (error) {
            console.error(`  Error fetching lists from folder ${folder.id}: ${error}`);
          }
        }
      } catch {
        // Folders endpoint failed, continue
      }

      if (listsWithFolders.length === 0) {
        console.log(`  ℹ️  No task lists found in this space`);
        return;
      }

      console.log(`  Found ${listsWithFolders.length} task list(s)`);

      // Process each list and save tasks in appropriate folder
      for (const { list, folderName } of listsWithFolders) {
        try {
          // Determine the target path based on folder
          let targetPath = spacePath;
          if (folderName) {
            targetPath = join(spacePath, this.sanitizeFileName(folderName));
            await this.ensureDirectory(targetPath);
          }

          // Create a CSV file for this list
          const listFileName = this.sanitizeFileName(list.name) + '_tasks.csv';
          const csvPath = join(targetPath, listFileName);

          // Fetch tasks for this list
          const { tasks } = await this.client.getTasks(list.id, true);
          
          if (!tasks || tasks.length === 0) {
            continue;
          }

          // Convert tasks to CSV
          const csvContent = objectsToCSV(tasks);
          await writeFile(csvPath, csvContent, "utf-8");
          
          const locationInfo = folderName ? `${folderName}/${list.name}` : list.name;
          console.log(`    ✓ ${tasks.length} task(s) → ${locationInfo}`);
          
          totalTasks += tasks.length;
          totalLists++;

          // Small delay to respect rate limits
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`  Error exporting tasks for list ${list.name}: ${error}`);
        }
      }

      if (totalTasks > 0) {
        console.log(`  ✓ Saved ${totalTasks} task(s) across ${totalLists} list(s)`);
      } else {
        console.log(`  ℹ️  No tasks found in this space`);
      }
    } catch (error) {
      console.error(`  Error exporting tasks: ${error}`);
      // Don't throw - continue with other exports
    }
  }

  async crawlSpace(spaceId: string, spaceName: string, workspaceId: string, includeDocs: boolean = true, includeTasks: boolean = false): Promise<void> {
    if (!workspaceId && includeDocs) {
      throw new Error("Workspace ID is required to fetch document content");
    }

    console.log(`\nCrawling space: \x1b[34m${spaceName}\x1b[0m (${spaceId})`);

    // Create space directory
    const spaceDirName = this.sanitizeFileName(spaceName);
    const spacePath = join(this.outputDir, spaceDirName);
    await this.ensureDirectory(spacePath);

    try {
      // Export tasks organized by folder/list structure if requested
      if (includeTasks) {
        await this.exportTasksByFolder(spaceId, spacePath, spaceName);
      }

      // Get all documents in the space if requested
      if (includeDocs) {
        console.log(`  Searching for documents...`);
        const result = await this.client.getDocuments(spaceId, workspaceId);
        const documents = result.documents || [];

        if (documents.length === 0) {
          console.log(`  ℹ️  No documents found in this space`);
        } else {
          console.log(`  ✓ Found ${documents.length} document(s)`);

          // Documents are already fully fetched with pages from getDocuments()
          // Just need to re-fetch any that are missing pages
          const documentsWithContent: ClickUpDocument[] = [];
          for (const doc of documents) {
            try {
              // Check if document already has pages (fetched by getDocuments)
              if (doc.pages && doc.pages.length > 0) {
                documentsWithContent.push(doc);
                console.log(`  Fetched: ${doc.name} (${doc.pages.length} page(s))`);
              } else {
                // Re-fetch if pages are missing
                const { document, pages } = await this.client.getDocument(doc.id, workspaceId);
                document.pages = pages;
                documentsWithContent.push(document);
                console.log(`  Fetched: ${document.name} (${pages.length} page(s))`);
                // Small delay to respect rate limits
                await this.delay(300);
              }
            } catch (error) {
              console.error(`  Error fetching document ${doc.id}: ${error}`);
              // Continue with other documents instead of failing completely
              continue;
            }
          }

          // Build document tree from the flattened list
          const rootNodes = this.buildDocumentTree(documentsWithContent);

          // Process each root document (saves pages separately)
          for (const rootNode of rootNodes) {
            // Convert ClickUpDocument to DocumentNode for compatibility
            const sourceDoc = documentsWithContent.find(d => d.id === rootNode.id);
            const node: DocumentNode = {
              id: rootNode.id,
              name: rootNode.name,
              type: rootNode.type,
              content: rootNode.content,
              children: rootNode.children,
              parentId: rootNode.parentId,
              pages: sourceDoc?.pages
            };

            // Determine the correct path based on folder hierarchy
            let targetPath = spacePath;
            if ((sourceDoc as any)?.folderName) {
              const folderPath = join(spacePath, this.sanitizeFileName((sourceDoc as any).folderName));
              await this.ensureDirectory(folderPath);
              targetPath = folderPath;
            }

            await this.processDocumentNode(node, targetPath, spaceName);
          }
        }
      }
    } catch (error) {
      console.error(`Error crawling space \x1b[34m${spaceName}\x1b[0m: ${error}`);
      throw error;
    }
  }

}

