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

    async getWorkspaces(): Promise<{ teams: Array<{ id: string; name: string }> }> {
        return this.request("/team");
    }

    async getSpaces(workspaceId: string): Promise<{ spaces: ClickUpSpace[] }> {
        return this.request(`/team/${workspaceId}/space?archived=false`);
    }

    async getFolders(spaceId: string): Promise<{ folders: ClickUpFolder[] }> {
        return this.request(`/space/${spaceId}/folder?archived=false`);
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

        // Get documents through doc views (this is the primary method)
        try {
            const { views } = await this.getViews(spaceId);
            const docViews = views.filter((v) => v.type === "doc");

            if (docViews.length === 0) {
                return { documents: [] };
            }

            for (const view of docViews) {
                // View ID is the document ID - fetch the document
                // This will throw if pages can't be fetched
                const { document, pages } = await this.getDocument(view.id, workspaceId);
                if (document) {
                    // Attach pages to document
                    document.pages = pages;
                    allDocuments.push(document);
                }
            }
        } catch (error: any) {
            console.error(`    Failed to fetch documents: ${error.message}`);
            throw error;
        }

        // Try getting documents from folders
        try {
            const { folders } = await this.getFolders(spaceId);
            for (const folder of folders) {
                try {
                    const folderDocs = await this.getDocumentsFromFolder(folder.id);
                    if (folderDocs.documents && folderDocs.documents.length > 0) {
                        allDocuments.push(...folderDocs.documents);
                    }
                } catch {
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
                        allDocuments.push(...listDocs.documents);
                    }
                } catch {
                    continue;
                }
            }

            // Lists in folders
            const { folders } = await this.getFolders(spaceId);
            for (const folder of folders) {
                try {
                    const { lists } = await this.getLists(folder.id);
                    for (const list of lists) {
                        try {
                            const listDocs = await this.getDocumentsFromList(list.id);
                            if (listDocs.documents && listDocs.documents.length > 0) {
                                allDocuments.push(...listDocs.documents);
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

        // Remove duplicates based on document ID
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
                }

                // Convert to ClickUpPage format
                return pages.map((page: any) => ({
                    id: page.id,
                    name: page.name || '',
                    content: page.content || '',
                    parent_id: page.parent_id || page.parent?.id || null,
                    date_created: page.date_created || 0,
                    date_updated: page.date_updated || page.date_edited || 0,
                }));
            }
        } catch {
            // Pages request failed
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

            if (pages.length === 0 && workspaceId) {
                throw new Error(
                    `Could not fetch pages for document "${viewData.name}" (ID: ${documentId}). ` +
                    `Tried API v3 endpoint /api/v3/workspaces/${workspaceId}/docs/${documentId}/pages`
                );
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



