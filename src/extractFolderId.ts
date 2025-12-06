export class InvalidFolderUrlError extends Error {
  public readonly code: "INVALID_FOLDER_URL" = "INVALID_FOLDER_URL";

  constructor(message: string) {
    super(message);
    this.name = "InvalidFolderUrlError";
  }
}

export const extractFolderId = (folderUrl: string): string => {
  if (!folderUrl || typeof folderUrl !== "string") {
    throw new InvalidFolderUrlError("Folder URL must be a non-empty string.");
  }

  const trimmed = folderUrl.trim();
  if (!trimmed) {
    throw new InvalidFolderUrlError("Folder URL must be a non-empty string.");
  }

  // Allow users to provide a bare folder ID directly (alphanumeric, dashes, underscores, at least 10 chars)
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed) && !trimmed.includes("://")) {
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
  const search = url.search;

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

  // Try ALL known Google Drive folder formats (order matters - most specific first)
  const patterns = [
    /\/u\/\d+\/folders\/([A-Za-z0-9_-]+)/,        // /u/1/folders/{id} or /u/0/folders/{id}
    /\/folders\/([A-Za-z0-9_-]+)/,                // /folders/{id}
    /folderview\?id=([A-Za-z0-9_-]+)/,            // folderview?id={id}
    /open\?id=([A-Za-z0-9_-]+)/,                  // open?id={id}
    /[?&]id=([A-Za-z0-9_-]+)/,                    // ?id={id} or &id={id} (catch-all for query params)
  ];

  for (const pattern of patterns) {
    const match = (path + search).match(pattern);
    if (match && match[1] && match[1].length >= 10) {
      return match[1];
    }
  }

  // Also check query params directly as fallback
  const idParam = url.searchParams.get("id");
  if (idParam && /^[A-Za-z0-9_-]{10,}$/.test(idParam)) {
    return idParam;
  }

  throw new InvalidFolderUrlError(
    "Could not extract folder ID from the provided URL. Supported formats:\n" +
    "- https://drive.google.com/drive/folders/FOLDER_ID\n" +
    "- https://drive.google.com/drive/u/1/folders/FOLDER_ID\n" +
    "- https://drive.google.com/folderview?id=FOLDER_ID\n" +
    "- https://drive.google.com/open?id=FOLDER_ID\n" +
    "- Or just the folder ID"
  );
};

