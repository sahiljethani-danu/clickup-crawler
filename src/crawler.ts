import { ClickUpClient, ClickUpDocument } from "./clickup-client";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

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

  async crawlSpace(spaceId: string, spaceName: string, workspaceId: string): Promise<void> {
    if (!workspaceId) {
      throw new Error("Workspace ID is required to fetch document content");
    }

    console.log(`\nCrawling space: ${spaceName} (${spaceId})`);

    try {
      // Get all documents in the space (checks space, views, folders, and lists)
      console.log(`  Searching for documents...`);
      const result = await this.client.getDocuments(spaceId, workspaceId);
      const documents = result.documents || [];

      if (documents.length === 0) {
        console.log(`  ℹ️  No documents found in this space`);
        return;
      }

      console.log(`  ✓ Found ${documents.length} document(s)`);

      // Fetch full content for each document
      const documentsWithContent: ClickUpDocument[] = [];
      for (const doc of documents) {
        try {
          const { document, pages } = await this.client.getDocument(doc.id, workspaceId);
          document.pages = pages;
          documentsWithContent.push(document);
          console.log(`  Fetched: ${document.name} (${pages.length} page(s))`);
          // Small delay to respect rate limits (100 requests/minute = ~600ms between requests)
          await this.delay(600);
        } catch (error) {
          console.error(`  Error fetching document ${doc.id}: ${error}`);
          throw error; // Re-throw to fail fast
        }
      }

      // Build document tree
      const rootNodes = this.buildDocumentTree(documentsWithContent);

      // Create space directory
      const spaceDirName = this.sanitizeFileName(spaceName);
      const spacePath = join(this.outputDir, spaceDirName);
      await this.ensureDirectory(spacePath);

      // Process each root document (now saves pages separately)
      for (const rootNode of rootNodes) {
        // Convert ClickUpDocument to DocumentNode for compatibility
        const node: DocumentNode = {
          id: rootNode.id,
          name: rootNode.name,
          type: rootNode.type,
          content: rootNode.content,
          children: rootNode.children,
          parentId: rootNode.parentId,
          pages: documentsWithContent.find(d => d.id === rootNode.id)?.pages
        };
        await this.processDocumentNode(node, spacePath, spaceName);
      }
    } catch (error) {
      console.error(`Error crawling space ${spaceName}: ${error}`);
      throw error;
    }
  }

}

