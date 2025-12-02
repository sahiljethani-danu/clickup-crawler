interface ClickUpSpace {
    id: string;
    name: string;
    color?: string;
    private: boolean;
    archived: boolean;
}

interface ClickUpFolder {
    id: string;
    name: string;
    orderindex: number;
    override_statuses: boolean;
    hidden: boolean;
    space: {
        id: string;
        name: string;
    };
    task_count: string;
    archived: boolean;
    statuses: any[];
    lists: ClickUpList[];
    permission_level: string;
}

interface ClickUpList {
    id: string;
    name: string;
    orderindex: number;
    status: {
        status: string;
        color: string;
        hide_label: boolean;
    };
    priority: any;
    assignee: any;
    task_count: number;
    due_date: string | null;
    due_date_time: boolean;
    start_date: string | null;
    start_date_time: boolean;
    folder: {
        id: string;
        name: string;
        hidden: boolean;
        access: boolean;
    };
    space: {
        id: string;
        name: string;
        access: boolean;
    };
    archived: boolean;
    override_statuses: boolean;
    statuses: any[];
    permission_level: string;
}

interface ClickUpView {
    id: string;
    name: string;
    type: string;
    parent: {
        id: string;
        name: string;
        type: string;
    };
    orderindex: number;
}

interface ClickUpPage {
    id: string;
    name: string;
    content: string;
    parent_id?: string | null;
    date_created: number;
    date_updated: number;
}

interface ClickUpDocument {
    id: string;
    name: string;
    type: string;
    date_created: string;
    date_updated: string;
    parent: {
        id: string;
        name: string;
        type: string;
    } | null;
    orderindex: number;
    content: string;
    children?: ClickUpDocument[];
    pages?: ClickUpPage[];
}

export class ClickUpClient {
    private apiToken: string;
    private baseUrl = "https://api.clickup.com/api/v2";
    private baseUrlV3 = "https://api.clickup.com/api/v3";

    constructor(apiToken: string) {
        this.apiToken = apiToken;
    }

    private async request<T>(endpoint: string): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            headers: {
                Authorization: this.apiToken,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            const error = new Error(
                `ClickUp API error: ${response.status} ${response.statusText} - ${errorText}`
            ) as any;
            error.status = response.status;
            error.isRateLimit = response.status === 429;
            throw error;
        }

        const data = await response.json();
        return data;
    }

    private async requestV3<T>(endpoint: string): Promise<T> {
        const response = await fetch(`${this.baseUrlV3}${endpoint}`, {
            headers: {
                Authorization: this.apiToken,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            const error = new Error(
                `ClickUp API v3 error: ${response.status} ${response.statusText} - ${errorText}`
            ) as any;
            error.status = response.status;
            error.isRateLimit = response.status === 429;
            throw error;
        }

        const data = await response.json();
        return data;
    }

    /**
     * Recursively flatten a list of documents, including all nested children
     */
    private flattenDocuments(docs: ClickUpDocument[]): ClickUpDocument[] {
        const result: ClickUpDocument[] = [];
        for (const doc of docs) {
            result.push(doc);
            if (doc.children && doc.children.length > 0) {
                result.push(...this.flattenDocuments(doc.children));
            }
        }
        return result;
    }

    async getWorkspaces(): Promise<{ teams: Array<{ id: string; name: string }> }> {
        return this.request("/team");
    }

    async getSpaces(workspaceId: string): Promise<{ spaces: ClickUpSpace[] }> {
        return this.request(`/team/${workspaceId}/space?archived=false`);
    }

    async getFolders(spaceId: string): Promise<{ folders: ClickUpFolder[] }> {
        return this.request(`/space/${spaceId}/folder?archived=false`);
    }

    /**
     * Get all folders recursively, including nested subfolders
     */
    async getAllFoldersRecursively(spaceId: string): Promise<ClickUpFolder[]> {
        const allFolders: ClickUpFolder[] = [];
        const processedFolderIds = new Set<string>();

        const processFolders = async (parentId: string, isSpace: boolean = false) => {
            try {
                let folders: ClickUpFolder[] = [];
                
                if (isSpace) {
                    const result = await this.getFolders(parentId);
                    folders = result.folders || [];
                } else {
                    // Try to get subfolders of a folder (this endpoint may not exist)
                    try {
                        const result = await this.request<{ folders: ClickUpFolder[] }>(`/folder/${parentId}/folder?archived=false`);
                        folders = result.folders || [];
                    } catch {
                        // Subfolder endpoint doesn't exist, skip
                        return;
                    }
                }

                for (const folder of folders) {
                    if (!processedFolderIds.has(folder.id)) {
                        processedFolderIds.add(folder.id);
                        allFolders.push(folder);
                        
                        // Recursively process subfolders
                        await processFolders(folder.id, false);
                        
                        // Small delay to respect rate limits
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                }
            } catch (error) {
                // Folder access failed, continue
                console.log(`    Note: Could not access folders for ${isSpace ? 'space' : 'folder'} ${parentId}`);
            }
        };

        await processFolders(spaceId, true);
        return allFolders;
    }

    async getLists(folderId: string): Promise<{ lists: ClickUpList[] }> {
        return this.request(`/folder/${folderId}/list?archived=false`);
    }

    async getListsInSpace(spaceId: string): Promise<{ lists: ClickUpList[] }> {
        return this.request(`/space/${spaceId}/list?archived=false`);
    }

    async getViews(spaceId: string): Promise<{ views: ClickUpView[] }> {
        return this.request(`/space/${spaceId}/view`);
    }

    async getViewsInFolder(folderId: string): Promise<{ views: ClickUpView[] }> {
        try {
            return await this.request(`/folder/${folderId}/view`);
        } catch {
            return { views: [] };
        }
    }

    async getView(viewId: string): Promise<any> {
        try {
            return await this.request(`/view/${viewId}`);
        } catch (error: any) {
            throw error;
        }
    }

    async getTasks(listId: string, includeSubtasks: boolean = true): Promise<any> {
        try {
            // Use query parameters to get as much data as possible in bulk
            let url = `/list/${listId}/task?archived=false&include_closed=true`;
            if (includeSubtasks) {
                url += `&subtasks=true`;
            }
            // Try to include more fields - these parameters may vary by API version
            url += `&include_markdown_description=true`;
            return await this.request(url);
        } catch {
            return { tasks: [] };
        }
    }

    async getTask(taskId: string): Promise<any> {
        try {
            // Fetch task with all available details
            const task = await this.request(`/task/${taskId}?include_subtasks=true&include_markdown_description=true`);
            return task;
        } catch {
            return null;
        }
    }

    async getAllTasksInSpace(spaceId: string, onTask?: (task: any) => Promise<void>): Promise<void> {
        let totalListsProcessed = 0;
        let totalTasksProcessed = 0;

        try {
            // Get all lists in the space (both in folders and directly in space)
            const { lists: spaceLists } = await this.getListsInSpace(spaceId);
            const totalLists = spaceLists.length;

            for (const list of spaceLists) {
                try {
                    // Use bulk API with query parameters to get as much data as possible
                    const { tasks } = await this.getTasks(list.id, true);
                    if (tasks && Array.isArray(tasks)) {
                        const listTaskCount = tasks.length;
                        // Tasks from list endpoint may already have most data, but check if we need individual fetches
                        // Only fetch individual tasks if they're missing critical fields
                        for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                            const task = tasks[taskIndex];

                            // Check if task has all the data we need (subtasks, description, etc.)
                            const needsFullFetch = !task.subtasks || !task.description || !task.markdown_description;

                            let finalTask = task;
                            if (needsFullFetch) {
                                try {
                                    const fullTaskResponse = await this.getTask(task.id);
                                    // Handle both wrapped and unwrapped responses
                                    finalTask = fullTaskResponse?.task || fullTaskResponse || task;
                                    totalTasksProcessed++;

                                    // Small delay to respect rate limits
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                } catch (error: any) {
                                    // Check if this is a rate limit error
                                    if (error.isRateLimit) {
                                        console.log(`⚠️  Rate limited! Lists: ${totalListsProcessed}/${totalLists}, List: ${list.name}, Tasks in list: ${taskIndex + 1}/${listTaskCount}, Total processed: ${totalTasksProcessed}`);
                                    }
                                    // If full task fetch fails, use the bulk task data
                                    finalTask = task;
                                    totalTasksProcessed++;
                                }
                            } else {
                                // Use the bulk task data directly - it has everything we need
                                totalTasksProcessed++;
                            }

                            // Call callback if provided, otherwise just process
                            if (onTask && finalTask) {
                                await onTask(finalTask);
                            }
                        }
                    }
                    totalListsProcessed++;
                } catch (error: any) {
                    if (error.isRateLimit) {
                        console.log(`⚠️  Rate limited! Lists: ${totalListsProcessed}/${totalLists}, List: ${list.name}, Total processed: ${totalTasksProcessed}`);
                    }
                    console.error(`Error fetching tasks from list ${list.id}: ${error}`);
                }
            }

            // Also get tasks from lists in folders
            try {
                const { folders } = await this.getFolders(spaceId);
                for (const folder of folders) {
                    try {
                        const { lists } = await this.getLists(folder.id);
                        for (const list of lists) {
                            try {
                                // Use bulk API with query parameters to get as much data as possible
                                const { tasks } = await this.getTasks(list.id, true);
                                if (tasks && Array.isArray(tasks)) {
                                    const listTaskCount = tasks.length;
                                    // Tasks from list endpoint may already have most data, but check if we need individual fetches
                                    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
                                        const task = tasks[taskIndex];

                                        // Check if task has all the data we need (subtasks, description, etc.)
                                        const needsFullFetch = !task.subtasks || !task.description || !task.markdown_description;

                                        let finalTask = task;
                                        if (needsFullFetch) {
                                            try {
                                                const fullTaskResponse = await this.getTask(task.id);
                                                // Handle both wrapped and unwrapped responses
                                                finalTask = fullTaskResponse?.task || fullTaskResponse || task;
                                                totalTasksProcessed++;

                                                // Small delay to respect rate limits
                                                await new Promise(resolve => setTimeout(resolve, 100));
                                            } catch (error: any) {
                                                // Check if this is a rate limit error
                                                if (error.isRateLimit) {
                                                    console.log(`⚠️  Rate limited! Folder: ${folder.name}, List: ${list.name}, Tasks in list: ${taskIndex + 1}/${listTaskCount}, Total processed: ${totalTasksProcessed}`);
                                                }
                                                // If full task fetch fails, use the bulk task data
                                                finalTask = task;
                                                totalTasksProcessed++;
                                            }
                                        } else {
                                            // Use the bulk task data directly - it has everything we need
                                            totalTasksProcessed++;
                                        }

                                        // Call callback if provided, otherwise just process
                                        if (onTask && finalTask) {
                                            await onTask(finalTask);
                                        }
                                    }
                                }
                                totalListsProcessed++;
                            } catch (error: any) {
                                if (error.isRateLimit) {
                                    console.log(`⚠️  Rate limited! Folder: ${folder.name}, List: ${list.name}, Total processed: ${totalTasksProcessed}`);
                                }
                                console.error(`Error fetching tasks from list ${list.id}: ${error}`);
                            }
                        }
                    } catch (error: any) {
                        if (error.isRateLimit) {
                            console.log(`⚠️  Rate limited! Folder: ${folder.name}, Total processed: ${totalTasksProcessed}`);
                        }
                        console.error(`Error fetching lists from folder ${folder.id}: ${error}`);
                    }
                }
            } catch (error: any) {
                if (error.isRateLimit) {
                    console.log(`⚠️  Rate limited! Total processed: ${totalTasksProcessed}`);
                }
                // Folders endpoint failed, continue
            }
        } catch (error) {
            console.error(`Error fetching tasks from space ${spaceId}: ${error}`);
        }
    }

    async getDocuments(spaceId: string, workspaceId?: string): Promise<{ documents: ClickUpDocument[] }> {
        const allDocuments: ClickUpDocument[] = [];
        const processedDocIds = new Set<string>();

        // Helper to add document and all its children recursively
        const addDocumentRecursively = async (doc: ClickUpDocument) => {
            if (processedDocIds.has(doc.id)) return;
            processedDocIds.add(doc.id);

            try {
                // Fetch full document with pages
                const { document, pages } = await this.getDocument(doc.id, workspaceId);
                document.pages = pages;
                allDocuments.push(document);

                // Small delay to respect rate limits
                await new Promise(resolve => setTimeout(resolve, 100));

                // Recursively process children if they exist
                if (doc.children && doc.children.length > 0) {
                    for (const child of doc.children) {
                        await addDocumentRecursively(child);
                    }
                }
            } catch (error: any) {
                console.error(`    Failed to fetch document ${doc.id}: ${error.message}`);
                // Still try to process children even if parent fails
                if (doc.children && doc.children.length > 0) {
                    for (const child of doc.children) {
                        await addDocumentRecursively(child);
                    }
                }
            }
        };

        // Note: We're NOT using the workspace-level v3 API here because it returns ALL docs
        // from the entire workspace, not just this space. This would cause duplication
        // across all spaces. Instead, we'll use space-specific endpoints.

        // Get documents through doc views (this is the primary method for space-level)
        try {
            const { views } = await this.getViews(spaceId);
            const docViews = views.filter((v) => v.type === "doc");

            for (const view of docViews) {
                if (processedDocIds.has(view.id)) continue;

                try {
                    // View ID is the document ID - fetch the document with its full tree
                    const { document, pages } = await this.getDocument(view.id, workspaceId);
                    if (document && !processedDocIds.has(document.id)) {
                        document.pages = pages;
                        processedDocIds.add(document.id);
                        allDocuments.push(document);

                        // Check for nested docs/children and process them
                        if (document.children && document.children.length > 0) {
                            for (const child of document.children) {
                                await addDocumentRecursively(child);
                            }
                        }

                        // Small delay to respect rate limits
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                } catch (error: any) {
                    console.error(`    Failed to fetch document from view ${view.id}: ${error.message}`);
                }
            }
        } catch (error: any) {
            console.error(`    Failed to fetch views: ${error.message}`);
        }

        // Try getting documents from folders (including nested subfolders)
        let allFolders: ClickUpFolder[] = [];
        try {
            allFolders = await this.getAllFoldersRecursively(spaceId);
            if (allFolders.length > 0) {
                console.log(`    Found ${allFolders.length} folder(s) (including nested)`);
            }
            
            for (const folder of allFolders) {
                try {
                    // Try to get documents directly from folder
                    const folderDocs = await this.getDocumentsFromFolder(folder.id);
                    if (folderDocs.documents && folderDocs.documents.length > 0) {
                        for (const doc of folderDocs.documents) {
                            await addDocumentRecursively(doc);
                        }
                    }

                    // Also try to get views (documents) from folder
                    const folderViews = await this.getViewsInFolder(folder.id);
                    const docViews = folderViews.views.filter((v) => v.type === "doc");
                    if (docViews.length > 0) {
                        for (const view of docViews) {
                            if (processedDocIds.has(view.id)) continue;

                            try {
                                                const { document, pages } = await this.getDocument(view.id, workspaceId);
                                if (document && !processedDocIds.has(document.id)) {
                                    document.pages = pages;
                                    // Store folder information in the document for hierarchy preservation
                                    (document as any).folderName = folder.name;
                                    (document as any).folderId = folder.id;
                                    processedDocIds.add(document.id);
                                    allDocuments.push(document);

                                    // Check for nested docs/children and process them
                                    if (document.children && document.children.length > 0) {
                                        for (const child of document.children) {
                                            await addDocumentRecursively(child);
                                        }
                                    }

                                    // Small delay to respect rate limits
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                }
                            } catch (error: any) {
                                console.error(`    Failed to fetch document from folder view ${view.id}: ${error.message}`);
                            }
                        }
                    }
                } catch (error) {
                    // Folder access failed, continue with next folder
                    continue;
                }
            }
        } catch {
            // Folders endpoint failed, continue
        }

        // Try getting documents from lists (both in folders and directly in space)
        try {
            // Lists directly in space
            const { lists: spaceLists } = await this.getListsInSpace(spaceId);
            for (const list of spaceLists) {
                try {
                    const listDocs = await this.getDocumentsFromList(list.id);
                    if (listDocs.documents && listDocs.documents.length > 0) {
                        for (const doc of listDocs.documents) {
                            await addDocumentRecursively(doc);
                        }
                    }
                } catch {
                    continue;
                }
            }

            // Lists in folders (including nested subfolders)
            for (const folder of allFolders) {
                try {
                    const { lists } = await this.getLists(folder.id);
                    for (const list of lists) {
                        try {
                            const listDocs = await this.getDocumentsFromList(list.id);
                            if (listDocs.documents && listDocs.documents.length > 0) {
                                for (const doc of listDocs.documents) {
                                    await addDocumentRecursively(doc);
                                }
                            }
                        } catch {
                            continue;
                        }
                    }
                } catch {
                    continue;
                }
            }
        } catch {
            // Lists endpoint failed
        }

        // Remove duplicates based on document ID (belt and suspenders)
        const uniqueDocuments = Array.from(
            new Map(allDocuments.map((doc) => [doc.id, doc])).values()
        );

        return { documents: uniqueDocuments };
    }

    async getDocumentsFromView(viewId: string): Promise<{ documents: ClickUpDocument[] }> {
        // Documents might be accessed through views
        // This endpoint structure may need to be verified
        return this.request(`/view/${viewId}/doc`);
    }

    async getDocumentsFromFolder(folderId: string): Promise<{ documents: ClickUpDocument[] }> {
        // Try both singular and plural endpoints
        try {
            return await this.request(`/folder/${folderId}/doc`);
        } catch {
            try {
                return await this.request(`/folder/${folderId}/docs`);
            } catch {
                return { documents: [] };
            }
        }
    }

    async getDocumentsFromList(listId: string): Promise<{ documents: ClickUpDocument[] }> {
        // Try both singular and plural endpoints
        try {
            return await this.request(`/list/${listId}/doc`);
        } catch {
            try {
                return await this.request(`/list/${listId}/docs`);
            } catch {
                return { documents: [] };
            }
        }
    }

    /**
     * Get all documents in a workspace using the v3 API
     * This returns the full tree structure including nested docs
     */
    async getAllDocsInWorkspace(workspaceId: string): Promise<ClickUpDocument[]> {
        try {
            // The v3 API can return all docs in a workspace
            const response: any = await this.requestV3(`/workspaces/${workspaceId}/docs`);
            
            let docs: any[] = [];
            if (Array.isArray(response)) {
                docs = response;
            } else if (response && Array.isArray(response.docs)) {
                docs = response.docs;
            } else if (response && response.data && Array.isArray(response.data)) {
                docs = response.data;
            }

            // Convert to ClickUpDocument format and flatten
            const documents: ClickUpDocument[] = docs.map((doc: any) => this.convertToClickUpDocument(doc));
            return this.flattenDocuments(documents);
        } catch (error: any) {
            console.log(`    Note: v3 workspace docs endpoint not available, falling back to space-level fetching`);
            return [];
        }
    }

    /**
     * Convert raw API doc response to ClickUpDocument format
     */
    private convertToClickUpDocument(doc: any): ClickUpDocument {
        return {
            id: doc.id,
            name: doc.name || 'Untitled',
            type: doc.type || 'doc',
            date_created: doc.date_created || '',
            date_updated: doc.date_updated || doc.date_created || '',
            parent: doc.parent ? {
                id: String(doc.parent.id || doc.parent),
                name: doc.parent.name || '',
                type: doc.parent.type || 'unknown'
            } : null,
            orderindex: doc.orderindex || 0,
            content: doc.content || '',
            children: doc.children ? doc.children.map((child: any) => this.convertToClickUpDocument(child)) : [],
            pages: []
        };
    }

    /**
     * Recursively flatten pages including all nested children/subpages
     */
    private flattenPages(pages: any[], parentId: string | null = null): ClickUpPage[] {
        const result: ClickUpPage[] = [];
        
        for (const page of pages) {
            // Add the current page
            result.push({
                id: page.id,
                name: page.name || '',
                content: page.content || '',
                parent_id: page.parent_id || page.parent_page_id || parentId || null,
                date_created: page.date_created || 0,
                date_updated: page.date_updated || page.date_edited || 0,
            });
            
            // Recursively process children/subpages
            if (page.children && Array.isArray(page.children) && page.children.length > 0) {
                result.push(...this.flattenPages(page.children, page.id));
            }
            
            // Also check for 'pages' array (alternative structure)
            if (page.pages && Array.isArray(page.pages) && page.pages.length > 0) {
                result.push(...this.flattenPages(page.pages, page.id));
            }
        }
        
        return result;
    }

    async getDocumentPages(documentId: string, workspaceId: string): Promise<ClickUpPage[]> {
        try {
            const pagesResponse = await fetch(`${this.baseUrlV3}/workspaces/${workspaceId}/docs/${documentId}/pages`, {
                headers: {
                    Authorization: this.apiToken,
                    "Content-Type": "application/json",
                },
            });

            if (pagesResponse.ok) {
                const pagesResult: any = await pagesResponse.json();
                
                // Pages are returned as an array directly
                let pages: any[] = [];
                if (Array.isArray(pagesResult)) {
                    pages = pagesResult;
                } else if (pagesResult && Array.isArray(pagesResult.pages)) {
                    pages = pagesResult.pages;
                } else if (pagesResult && pagesResult.pages) {
                    pages = [pagesResult.pages];
                } else if (pagesResult && pagesResult.data && Array.isArray(pagesResult.data)) {
                    pages = pagesResult.data;
                }

                // Recursively flatten all pages including nested children
                return this.flattenPages(pages);
            }
        } catch {
            // Silently fail - some docs may not have pages accessible
        }
        return [];
    }

    async getDocument(documentId: string, workspaceId?: string): Promise<{ document: ClickUpDocument; pages: ClickUpPage[] }> {
        // First, get the view/document metadata from v2 API
        let viewData: any = null;
        try {
            const viewResult: any = await this.request(`/view/${documentId}`);
            if (viewResult && viewResult.view) {
                viewData = viewResult.view;
            }
        } catch {
            // Try alternative endpoint
            try {
                viewData = await this.request(`/doc/${documentId}`);
            } catch {
                throw new Error(`Could not fetch document ${documentId}`);
            }
        }

        // Get pages from API v3
        let pages: ClickUpPage[] = [];
        if (workspaceId) {
            pages = await this.getDocumentPages(documentId, workspaceId);

            // Don't throw an error if pages are empty - some documents might legitimately have no pages
            if (pages.length === 0) {
                console.log(`    Note: Document "${viewData.name}" (ID: ${documentId}) has no pages`);
            }
        }

        // Build document object
        const document: ClickUpDocument = {
            id: viewData.id,
            name: viewData.name,
            type: viewData.type || 'doc',
            date_created: viewData.date_created || '',
            date_updated: viewData.date_updated || viewData.date_created || '',
            parent: viewData.parent ? {
                id: String(viewData.parent.id),
                name: '',
                type: String(viewData.parent.type)
            } : null,
            orderindex: viewData.orderindex || 0,
            content: '', // No longer combining pages into content
            children: [],
            pages: pages
        };

        return { document, pages };
    }

    async getDocumentContent(documentId: string, workspaceId?: string): Promise<string> {
        const { pages } = await this.getDocument(documentId, workspaceId);
        return pages.map(p => p.content).join('\n\n');
    }
}

export type {
    ClickUpSpace,
    ClickUpFolder,
    ClickUpList,
    ClickUpView,
    ClickUpDocument,
};



