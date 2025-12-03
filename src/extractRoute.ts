import { Router, Request, Response } from "express";
import axios from "axios";
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

    let folderId: string;
    try {
      // If this is a file URL like https://drive.google.com/file/d/FILE_ID/view,
      // handle it as a single-file extraction instead of a folder scrape.
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

      // eslint-disable-next-line no-console
      console.log(
        "[extractRoute] scrapePublicFolder result",
        folderId,
        "files:",
        result.files.length,
        "isEmptyFolder:",
        result.isEmptyFolder
      );

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

      // HTML loaded but we couldn't parse any files.
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

