export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  viewUrl: string;
  downloadUrl: string;
}

export interface ExtractFilesResponse {
  folderId: string;
  source: "public";
  files: DriveFile[];
  message?: string;
}

export type ExtractErrorCode =
  | "INVALID_FOLDER_URL"
  | "FOLDER_NOT_FOUND"
  | "FOLDER_ACCESS_FORBIDDEN"
  | "INTERNAL_ERROR";

export interface ErrorResponse {
  error: {
    code: ExtractErrorCode;
    message: string;
    details?: unknown;
  };
}

