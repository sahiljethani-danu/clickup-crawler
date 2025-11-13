/**
 * CSV utility functions for exporting ClickUp tasks and lists
 */

/**
 * Escape a value for CSV format
 */
export function escapeCSV(value: any): string {
    if (value === null || value === undefined) {
        return "";
    }

    const str = String(value);

    // If the value contains comma, quote, or newline, wrap it in quotes and escape quotes
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
}

/**
 * Flatten nested objects/arrays into a single string representation
 */
function flattenValue(value: any): string {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return "";
        }
        // If array contains objects, stringify them
        if (typeof value[0] === "object" && value[0] !== null) {
            return JSON.stringify(value);
        }
        return value.join("; ");
    }

    if (typeof value === "object") {
        return JSON.stringify(value);
    }

    return String(value);
}

/**
 * Extract all possible fields from an object recursively
 */
function extractAllFields(obj: any, prefix = ""): Record<string, any> {
    const fields: Record<string, any> = {};

    if (obj === null || obj === undefined) {
        return fields;
    }

    if (typeof obj !== "object") {
        return { [prefix || "value"]: obj };
    }

    if (Array.isArray(obj)) {
        // For arrays, create a field with the array content
        if (obj.length > 0 && typeof obj[0] === "object") {
            // Array of objects - stringify or create indexed fields
            fields[prefix || "array"] = JSON.stringify(obj);
        } else {
            // Array of primitives
            fields[prefix || "array"] = obj.join("; ");
        }
        return fields;
    }

    for (const [key, value] of Object.entries(obj)) {
        const fieldName = prefix ? `${prefix}.${key}` : key;

        if (value === null || value === undefined) {
            fields[fieldName] = "";
        } else if (typeof value === "object" && !Array.isArray(value)) {
            // Recursively extract nested object fields
            const nestedFields = extractAllFields(value, fieldName);
            Object.assign(fields, nestedFields);
        } else {
            fields[fieldName] = value;
        }
    }

    return fields;
}

/**
 * Convert an array of objects to CSV format
 */
export function objectsToCSV(objects: any[]): string {
    if (objects.length === 0) {
        return "";
    }

    // Extract all unique field names from all objects
    const allFields = new Set<string>();
    const fieldData: Map<string, Map<number, any>> = new Map();

    objects.forEach((obj, index) => {
        const fields = extractAllFields(obj);
        for (const [fieldName, value] of Object.entries(fields)) {
            allFields.add(fieldName);
            if (!fieldData.has(fieldName)) {
                fieldData.set(fieldName, new Map());
            }
            fieldData.get(fieldName)!.set(index, value);
        }
    });

    // Sort fields for consistent output
    const sortedFields = Array.from(allFields).sort();

    // Build CSV header
    const header = sortedFields.map(escapeCSV).join(",");

    // Build CSV rows
    const rows: string[] = [];
    objects.forEach((_, index) => {
        const row = sortedFields.map((field) => {
            const value = fieldData.get(field)?.get(index);
            return escapeCSV(flattenValue(value));
        });
        rows.push(row.join(","));
    });

    return [header, ...rows].join("\n");
}

/**
 * Convert a single object to CSV format (single row with header)
 */
export function objectToCSV(obj: any): string {
    const fields = extractAllFields(obj);
    const sortedFields = Object.keys(fields).sort();

    const header = sortedFields.map(escapeCSV).join(",");
    const row = sortedFields.map((field) => escapeCSV(flattenValue(fields[field]))).join(",");

    return [header, row].join("\n");
}

/**
 * Convert a single object to CSV row format (without header)
 */
export function objectToCSVRow(obj: any, fieldOrder: string[]): string {
    const fields = extractAllFields(obj);
    const row = fieldOrder.map((field) => {
        const value = fields[field];
        return escapeCSV(flattenValue(value));
    });
    return row.join(",");
}

/**
 * Get all field names from an object (for determining CSV header)
 */
export function getFieldNames(obj: any): Set<string> {
    const fields = extractAllFields(obj);
    return new Set(Object.keys(fields));
}

