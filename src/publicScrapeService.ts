import { google } from "googleapis";
import path from "path";
import fs from "fs";
import type { DriveFile } from "./fileTypes";

// ============================================================================
// INTERFACES & CUSTOM ERRORS
// ============================================================================

export interface PublicScrapeResult {
  files: DriveFile[];
  isEmptyFolder: boolean;
}

export class FolderNotFoundError extends Error {
  constructor(message = "Folder not found") {
    super(message);
    this.name = "FolderNotFoundError";
  }
}

export class PublicAccessForbiddenError extends Error {
  constructor(message = "Access forbidden") {
    super(message);
    this.name = "PublicAccessForbiddenError";
  }
}

// ============================================================================
// CONSTANTS & ENVIRONMENT VARIABLES
// ============================================================================

const WEB_APP_URL = process.env.APPS_SCRIPT_WEB_APP_URL;
const APPS_SCRIPT_SECRET = process.env.APPS_SCRIPT_SECRET;
const KEY_FILE_PATH = path.join(process.cwd(), "rock-arc-474018-a7-e1573eb95e22.json");

// Validate required environment variables at module load
if (!WEB_APP_URL) {
  throw new Error("Missing APPS_SCRIPT_WEB_APP_URL environment variable");
}
if (!APPS_SCRIPT_SECRET) {
  throw new Error("Missing APPS_SCRIPT_SECRET environment variable");
}

/**
 * Get Google Auth credentials from file or environment variable
 * For production (Render), use GOOGLE_SERVICE_ACCOUNT_KEY environment variable
 * For local development, use the key file
 */
function getAuthCredentials(): { keyFile?: string; credentials?: any; scopes: string[] } {
  // Check if environment variable is set (for production on Render)
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  
  if (serviceAccountKey) {
    try {
      const credentials = JSON.parse(serviceAccountKey);
      return {
        credentials,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      };
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[publicScrape] Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY:", error);
      }
      throw new Error("Invalid GOOGLE_SERVICE_ACCOUNT_KEY environment variable");
    }
  }
  
  // Fall back to key file (for local development only)
  if (fs.existsSync(KEY_FILE_PATH)) {
    return {
      keyFile: KEY_FILE_PATH,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    };
  }
  
  throw new Error(
    "Google Service Account credentials not found. " +
    "Either set GOOGLE_SERVICE_ACCOUNT_KEY environment variable or place key file at: " +
    KEY_FILE_PATH
  );
}

// ============================================================================
// INTERFACE: Apps Script Web App Response
// ============================================================================

interface AppsScriptItem {
  id: string;
  name: string;
  type: string; // mimeType
  viewUrl: string;
  downloadUrl?: string;
  kind: "file" | "folder";
}

interface AppsScriptResponse {
  count: number;
  items: AppsScriptItem[];
}

// ============================================================================
// MAIN FUNCTION: scrapePublicFolder
// ============================================================================

export async function scrapePublicFolder(
  folderId: string
): Promise<PublicScrapeResult> {
  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[publicScrape] Calling Apps Script Web App for folder: ${folderUrl}`);
  }

  try {
    const authOptions = getAuthCredentials();
    const auth = new google.auth.GoogleAuth(authOptions);
    const client = await auth.getClient();

    const response = await client.request({
      url: WEB_APP_URL!,
      method: "POST",
      data: { folderUrl, secret: APPS_SCRIPT_SECRET },
      headers: { "Content-Type": "application/json" },
    });

    if (process.env.NODE_ENV !== "production") {
      console.log(`[publicScrape] Web App response received`);
    }

    let result: AppsScriptResponse;
    
    if (typeof response.data === "string") {
      result = JSON.parse(response.data) as AppsScriptResponse;
    } else {
      result = response.data as AppsScriptResponse;
    }

    if (!result || !result.items) {
      console.error(`[publicScrape] Invalid response from Web App`);
      throw new Error("Apps Script Web App returned invalid response");
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(`[publicScrape] Web App returned ${result.count} items`);
    }

    const mappedFiles: DriveFile[] = result.items.map((item) => ({
      id: item.id,
      name: item.name,
      mimeType: item.type,
      viewUrl: item.viewUrl,
      downloadUrl: item.downloadUrl ?? null,
    }));

    const isEmptyFolder = mappedFiles.length === 0;

    if (process.env.NODE_ENV !== "production") {
      console.log(`[publicScrape] Mapped ${mappedFiles.length} items (isEmptyFolder: ${isEmptyFolder})`);
    }

    return {
      files: mappedFiles,
      isEmptyFolder,
    };
  } catch (error) {
    if (
      error instanceof FolderNotFoundError ||
      error instanceof PublicAccessForbiddenError
    ) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.message.includes("ENOENT") || error.message.includes("keyFile")) {
        console.error(`[publicScrape] Authentication error: Could not find key file`);
        throw new Error("Missing credentials");
      }

      if (error.message.includes("invalid_grant") || error.message.includes("unauthorized")) {
        console.error(`[publicScrape] Authentication error: Invalid credentials`);
        throw new Error("Invalid service account credentials");
      }

      if (error.message.includes("404") || error.message.includes("not found")) {
        throw new FolderNotFoundError(`Folder ${folderId} not found`);
      }

      if (error.message.includes("403") || error.message.includes("forbidden")) {
        throw new PublicAccessForbiddenError(`Folder ${folderId} access forbidden`);
      }
    }

    console.error(`[publicScrape] Error calling Apps Script Web App:`, error instanceof Error ? error.message : String(error));
    throw new Error(`Failed to scrape folder: ${error instanceof Error ? error.message : String(error)}`);
  }
}
