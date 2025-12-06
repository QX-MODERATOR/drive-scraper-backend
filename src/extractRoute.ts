import { Router, Request, Response } from "express";
import axios from "axios";
import * as XLSX from "xlsx";
import type { ErrorResponse, ExtractFilesResponse, DriveFile } from "./fileTypes";
import {
  extractFolderId,
  InvalidFolderUrlError,
} from "./extractFolderId";
import {
  scrapePublicFolder,
  FolderNotFoundError,
  PublicAccessForbiddenError,
} from "./publicScrapeService";

export const extractRouter = Router();

interface ExtractRequestBody {
  folderUrl: string;
}

const buildErrorResponse = (
  code: ErrorResponse["error"]["code"],
  message: string,
  details?: unknown
): ErrorResponse => ({
  error: {
    code,
    message,
    details,
  },
});

/**
 * Validate folder URL to prevent SSRF attacks
 * Only allows valid Google Drive folder URLs or folder IDs
 * Uses the same extraction logic to ensure consistency
 */
function validateFolderUrl(folderUrl: string): boolean {
  if (!folderUrl || typeof folderUrl !== "string") {
    return false;
  }

  const trimmed = folderUrl.trim();
  if (!trimmed) {
    return false;
  }

  // Allow bare folder IDs (alphanumeric, dashes, underscores, at least 10 chars)
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed) && !trimmed.includes("://")) {
    return true;
  }

  // Try to parse as URL and check if it's a Google Drive URL
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();
    
    // Only accept Google Drive hostnames
    if (hostname !== "drive.google.com" && hostname !== "docs.google.com") {
      return false;
    }

    // Check if we can extract a folder ID using the same patterns as extractFolderId
    const patterns = [
      /\/u\/\d+\/folders\/([A-Za-z0-9_-]+)/,        // /u/1/folders/{id}
      /\/folders\/([A-Za-z0-9_-]+)/,                // /folders/{id}
      /folderview\?id=([A-Za-z0-9_-]+)/,            // folderview?id={id}
      /open\?id=([A-Za-z0-9_-]+)/,                  // open?id={id}
      /[?&]id=([A-Za-z0-9_-]+)/,                    // ?id={id} or &id={id}
    ];

    const path = url.pathname;
    const search = url.search;

    for (const pattern of patterns) {
      const match = (path + search).match(pattern);
      if (match && match[1] && match[1].length >= 10) {
        return true;
      }
    }

    // Also check query params directly
    const idParam = url.searchParams.get("id");
    if (idParam && /^[A-Za-z0-9_-]{10,}$/.test(idParam)) {
      return true;
    }

    return false;
  } catch {
    // Not a valid URL, but might be a bare folder ID (already checked above)
    return false;
  }
}

const handleSingleFileLink = async (
  fileUrl: string,
  res: Response
): Promise<Response> => {
  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    const errorBody = buildErrorResponse(
      "INVALID_FOLDER_URL",
      "The provided URL is not a valid Google Drive link."
    );
    return res.status(400).json(errorBody);
  }

  const match = /\/file\/d\/([a-zA-Z0-9_-]{5,})\//.exec(url.pathname);
  if (!match || !match[1]) {
    const errorBody = buildErrorResponse(
      "INVALID_FOLDER_URL",
      "The provided URL is not a recognized Google Drive file link."
    );
    return res.status(400).json(errorBody);
  }

  const fileId = match[1];
  const viewUrl = `https://drive.google.com/file/d/${encodeURIComponent(
    fileId
  )}/view`;
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(
    fileId
  )}`;

  try {
    const resp = await axios.get<string>(viewUrl, {
      responseType: "text",
      validateStatus: () => true,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      },
    });

    const { status, data } = resp;

    if (
      status === 404 &&
      data.includes("Sorry, the file you have requested does not exist.")
    ) {
      const errorBody = buildErrorResponse(
        "FOLDER_NOT_FOUND",
        "File not found or no longer available."
      );
      return res.status(404).json(errorBody);
    }

    if (status >= 400 && status < 600) {
      const errorBody = buildErrorResponse(
        "FOLDER_ACCESS_FORBIDDEN",
        "This file is not publicly accessible. Please ensure its parent folder is shared as 'Anyone with the link can view' and try again."
      );
      return res.status(403).json(errorBody);
    }

    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(data);
    let name = fileId;
    if (titleMatch && titleMatch[1]) {
      let title = titleMatch[1].trim();
      title = title.replace(/\s*-\s*Google Drive\s*$/i, "");
      if (title) {
        name = title;
      }
    }

    const file: DriveFile = {
      id: fileId,
      name,
      mimeType: "application/octet-stream",
      viewUrl,
      downloadUrl,
    };

    const responseBody: ExtractFilesResponse = {
      folderId: fileId,
      source: "public",
      files: [file],
    };

    return res.status(200).json(responseBody);
  } catch {
    const errorBody = buildErrorResponse(
      "INTERNAL_ERROR",
      "Unexpected error while scraping the file."
    );
    return res.status(500).json(errorBody);
  }
};

extractRouter.post(
  "/extract",
  async (req: Request<unknown, unknown, ExtractRequestBody>, res: Response) => {
    const { folderUrl } = req.body;

    if (!folderUrl || typeof folderUrl !== "string") {
      const errorBody = buildErrorResponse(
        "INVALID_FOLDER_URL",
        "Request body must include a valid 'folderUrl' string."
      );
      return res.status(400).json(errorBody);
    }

    // SSRF Prevention: Validate folder URL format
    if (!validateFolderUrl(folderUrl)) {
      const errorBody = buildErrorResponse(
        "INVALID_FOLDER_URL",
        "Invalid Google Drive folder URL format."
      );
      return res.status(400).json(errorBody);
    }

    let folderId: string;
    try {
      try {
        const url = new URL(folderUrl);
        if (/\/file\/d\/[a-zA-Z0-9_-]{5,}\//.test(url.pathname)) {
          return handleSingleFileLink(folderUrl, res);
        }
      } catch {
        // not a URL; fall through to folder ID/URL parsing
      }

      folderId = extractFolderId(folderUrl);
    } catch (error: unknown) {
      if (error instanceof InvalidFolderUrlError) {
        const errorBody = buildErrorResponse(
          "INVALID_FOLDER_URL",
          error.message
        );
        return res.status(400).json(errorBody);
      }

      const errorBody = buildErrorResponse(
        "INTERNAL_ERROR",
        "Unexpected error while parsing folder URL."
      );
      return res.status(500).json(errorBody);
    }

    try {
      const result = await scrapePublicFolder(folderId);

      if (process.env.NODE_ENV !== "production") {
        console.log(`[extractRoute] scrapePublicFolder result: folderId=${folderId}, files=${result.files.length}, isEmptyFolder=${result.isEmptyFolder}`);
      }

      const base: Omit<ExtractFilesResponse, "files"> = {
        folderId,
        source: "public",
      };

      if (result.files.length > 0) {
        const responseBody: ExtractFilesResponse = {
          ...base,
          files: result.files,
        };
        return res.status(200).json(responseBody);
      }

      if (result.isEmptyFolder) {
        const responseBody: ExtractFilesResponse = {
          ...base,
          files: [],
          message:
            "Folder appears to be empty. Make sure it contains files and that 'Anyone with the link' has at least view permission.",
        };
        return res.status(200).json(responseBody);
      }

      const responseBody: ExtractFilesResponse = {
        ...base,
        files: [],
        message:
          "The folder HTML was loaded but no files could be parsed. Please ensure the folder is shared as 'Anyone with the link can view/edit' and try again. Google Drive HTML structure may have changed.",
      };
      return res.status(200).json(responseBody);
    } catch (error: unknown) {
      if (error instanceof FolderNotFoundError) {
        const errorBody = buildErrorResponse(
          "FOLDER_NOT_FOUND",
          "Folder not found or no longer available."
        );
        return res.status(404).json(errorBody);
      }

      if (error instanceof PublicAccessForbiddenError) {
        const errorBody = buildErrorResponse(
          "FOLDER_ACCESS_FORBIDDEN",
          "This folder is not publicly accessible. Please set it to 'Anyone with the link can view' and try again."
        );
        return res.status(403).json(errorBody);
      }

      const errorBody = buildErrorResponse(
        "INTERNAL_ERROR",
        "Unexpected error while scraping the folder."
      );
      return res.status(500).json(errorBody);
    }
  }
);

interface ExportRequestBody {
  files: DriveFile[];
  folderId?: string;
}

extractRouter.post(
  "/export",
  async (req: Request<unknown, unknown, ExportRequestBody>, res: Response) => {
    const { files } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      const errorBody = buildErrorResponse(
        "INVALID_FOLDER_URL",
        "Request body must include a 'files' array with at least one file."
      );
      return res.status(400).json(errorBody);
    }

    try {
      const workbook = XLSX.utils.book_new();
      const headers = ["Name", "ID", "MIME Type", "View URL", "Download URL"];
      const data = [headers];

      for (const file of files) {
        data.push([
          file.name,
          file.id,
          file.mimeType,
          file.viewUrl,
          typeof file.downloadUrl === "string" ? file.downloadUrl : "",
        ]);
      }

      const worksheet = XLSX.utils.aoa_to_sheet(data);
      worksheet["!cols"] = [
        { wch: 30 },
        { wch: 40 },
        { wch: 50 },
        { wch: 60 },
        { wch: 60 },
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, "Files");

      const xlsxBuffer = XLSX.write(workbook, {
        type: "buffer",
        bookType: "xlsx",
        cellStyles: true,
      });

      const filename = `drive-files-${Date.now()}.xlsx`;
      
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.setHeader("Content-Length", xlsxBuffer.length.toString());
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      return res.status(200).send(xlsxBuffer);
    } catch (error: unknown) {
      console.error("[extractRoute] Excel export error:", error);
      const errorBody = buildErrorResponse(
        "INTERNAL_ERROR",
        "Unexpected error while generating Excel file."
      );
      return res.status(500).json(errorBody);
    }
  }
);
