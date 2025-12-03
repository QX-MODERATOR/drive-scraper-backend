export class InvalidFolderUrlError extends Error {
  public readonly code: "INVALID_FOLDER_URL" = "INVALID_FOLDER_URL";

  constructor(message: string) {
    super(message);
    this.name = "InvalidFolderUrlError";
  }
}

const FOLDERS_PATH_REGEX = /\/folders\/([a-zA-Z0-9_-]+)/;

export const extractFolderId = (folderUrl: string): string => {
  if (!folderUrl || typeof folderUrl !== "string") {
    throw new InvalidFolderUrlError("Folder URL must be a non-empty string.");
  }

  const trimmed = folderUrl.trim();

  // Allow users to provide a bare folder ID directly, e.g. "1BH3r_...Rvvu4BoSi"
  const bareIdRegex = /^[a-zA-Z0-9_-]+$/;
  if (bareIdRegex.test(trimmed) && !trimmed.includes("://")) {
    return trimmed;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidFolderUrlError("Folder URL is not a valid URL.");
  }

  // Only accept Google Drive hostnames to avoid SSRF-style misuse
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== "drive.google.com" &&
    hostname !== "docs.google.com"
  ) {
    throw new InvalidFolderUrlError(
      "URL must be a Google Drive folder URL (drive.google.com)."
    );
  }

  const path = url.pathname;

  // If this is a file URL like:
  //   https://drive.google.com/file/d/FILE_ID/view
  // we explicitly reject it with a clearer message, since this tool expects a
  // *folder* URL, not an individual file link.
  const filePathMatch = /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(path);
  if (filePathMatch && filePathMatch[1]) {
    throw new InvalidFolderUrlError(
      "The provided URL is a file link, not a folder link. Open the file's parent folder in Google Drive and paste that folder URL instead."
    );
  }

  // 1) URL patterns like:
  //    https://drive.google.com/drive/folders/ABC123
  //    https://drive.google.com/drive/u/1/folders/ABC123
  //    https://drive.google.com/drive/folders/ABC123?resourcekey=xyz
  const folderMatch = FOLDERS_PATH_REGEX.exec(path);
  if (folderMatch && folderMatch[1]) {
    return folderMatch[1];
  }

  // 2) URL patterns with `id` query parameter:
  //    https://drive.google.com/open?id=ABC123
  //    https://drive.google.com/folderview?id=ABC123#...
  const idParam = url.searchParams.get("id");
  if (idParam) {
    return idParam;
  }

  throw new InvalidFolderUrlError(
    "Could not extract folder ID from the provided URL."
  );
};

