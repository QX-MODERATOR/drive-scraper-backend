import axios from "axios";
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
// CONSTANTS
// ============================================================================

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

// ============================================================================
// HELPER: Infer MIME type from file name extension
// ============================================================================

function inferMimeTypeFromName(name: string): string {
  const lower = name.toLowerCase();

  // Video formats
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".wmv")) return "video/x-ms-wmv";
  if (lower.endsWith(".flv")) return "video/x-flv";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  if (lower.endsWith(".3gp")) return "video/3gpp";

  // Audio formats
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".wma")) return "audio/x-ms-wma";

  // Image formats
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".tiff") || lower.endsWith(".tif")) return "image/tiff";

  // Document formats
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx"))
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".rtf")) return "application/rtf";
  if (lower.endsWith(".csv")) return "text/csv";

  // Archive formats
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".rar")) return "application/vnd.rar";
  if (lower.endsWith(".7z")) return "application/x-7z-compressed";
  if (lower.endsWith(".tar")) return "application/x-tar";
  if (lower.endsWith(".gz")) return "application/gzip";

  // Code / text formats
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".xml")) return "application/xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".js")) return "application/javascript";
  if (lower.endsWith(".ts")) return "application/typescript";
  if (lower.endsWith(".py")) return "text/x-python";
  if (lower.endsWith(".java")) return "text/x-java-source";
  if (lower.endsWith(".c") || lower.endsWith(".cpp") || lower.endsWith(".h"))
    return "text/x-c";

  // Default
  return "application/octet-stream";
}

// ============================================================================
// HELPER: Check if a name has a file extension (indicating it's a file, not folder)
// ============================================================================

function hasFileExtension(name: string): boolean {
  const lower = name.toLowerCase();
  
  // Common file extensions
  const fileExtensions = [
    // Video
    '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv', '.m4v', '.3gp', '.mpeg', '.mpg',
    // Audio
    '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma',
    // Image
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff', '.tif', '.raw',
    // Document
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.csv', '.odt', '.ods', '.odp',
    // Archive
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
    // Code
    '.json', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.rb', '.go', '.rs', '.php', '.sql',
    // Other
    '.exe', '.msi', '.dmg', '.iso', '.apk', '.ipa', '.deb', '.rpm',
    '.epub', '.mobi', '.azw', '.djvu',
    '.psd', '.ai', '.sketch', '.fig',
    '.srt', '.vtt', '.ass',
    '.torrent', '.nfo',
  ];
  
  return fileExtensions.some(ext => lower.endsWith(ext));
}

// ============================================================================
// HELPER: Parse IDs from a block of HTML using data-id="..." regex
// ============================================================================

function parseIdsFromBlock(htmlBlock: string): string[] {
  const idRegex = /data-id="([^"]+)"/g;
  const ids: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = idRegex.exec(htmlBlock)) !== null) {
    const id = match[1];
    // Filter out very short IDs or obvious non-IDs
    if (id && id.length >= 20 && /^[a-zA-Z0-9_-]+$/.test(id)) {
      ids.push(id);
    }
  }

  return ids;
}

// ============================================================================
// HELPER: Parse title from HTML response
// ============================================================================

function parseTitleFromHtml(html: string): string | null {
  // Try og:title first
  const ogTitleMatch = /<meta\s+property="og:title"\s+content="([^"]+)"/i.exec(
    html
  );
  if (ogTitleMatch && ogTitleMatch[1]) {
    let title = ogTitleMatch[1].trim();
    title = title.replace(/\s*-\s*Google Drive\s*$/i, "");
    if (title) return title;
  }

  // Fallback to <title>
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  if (titleMatch && titleMatch[1]) {
    let title = titleMatch[1].trim();
    title = title.replace(/\s*-\s*Google Drive\s*$/i, "");
    if (title) return title;
  }

  return null;
}

// ============================================================================
// HELPER: Verify folder IDs and return DriveFile[] for valid folders
// ============================================================================

async function verifyFolderIds(ids: string[]): Promise<{
  validFolders: DriveFile[];
  invalidIds: string[];
  detectedFiles: DriveFile[]; // Items that look like files based on extension
}> {
  const validFolders: DriveFile[] = [];
  const invalidIds: string[] = [];
  const detectedFiles: DriveFile[] = []; // Files detected by extension during folder verification

  console.log(`[publicScrape] Verifying ${ids.length} potential folder IDs...`);

  for (const id of ids) {
    const folderUrl = `https://drive.google.com/drive/folders/${id}`;

    try {
      const response = await axios.get<string>(folderUrl, {
        headers: { "User-Agent": USER_AGENT },
        validateStatus: () => true, // Don't throw on non-2xx
        timeout: 10000,
      });

      if (response.status >= 200 && response.status < 300) {
        const title = parseTitleFromHtml(response.data);
        if (title && title.length > 0) {
          // Check if the title has a file extension - if so, it's actually a file!
          if (hasFileExtension(title)) {
            const mimeType = inferMimeTypeFromName(title);
            const fileViewUrl = `https://drive.google.com/file/d/${id}/view`;
            detectedFiles.push({
              id,
              name: title,
              mimeType,
              viewUrl: fileViewUrl,
              downloadUrl: `https://drive.google.com/uc?export=download&id=${id}`,
            });
            console.log(`[publicScrape] ✓ Detected as FILE by extension: "${title}" (${id})`);
          } else {
            // No file extension - treat as folder
            validFolders.push({
              id,
              name: title,
              mimeType: FOLDER_MIME_TYPE,
              viewUrl: folderUrl,
              downloadUrl: folderUrl, // Folders don't have a download URL, use view URL
            });
            console.log(`[publicScrape] ✓ Folder verified: "${title}" (${id})`);
          }
        } else {
          console.log(
            `[publicScrape] ✗ Folder ID ${id} - could not parse title`
          );
          invalidIds.push(id);
        }
      } else {
        console.log(
          `[publicScrape] ✗ Folder ID ${id} - HTTP ${response.status}`
        );
        invalidIds.push(id);
      }
    } catch (error) {
      console.log(`[publicScrape] ✗ Folder ID ${id} - request failed`);
      invalidIds.push(id);
    }
  }

  console.log(
    `[publicScrape] Folder verification complete: ${validFolders.length} folders, ${detectedFiles.length} detected files, ${invalidIds.length} invalid`
  );

  return { validFolders, invalidIds, detectedFiles };
}

// ============================================================================
// HELPER: Verify file IDs and return DriveFile[] for valid files
// ============================================================================

async function verifyFileIds(ids: string[]): Promise<DriveFile[]> {
  const validFiles: DriveFile[] = [];

  console.log(`[publicScrape] Verifying ${ids.length} potential file IDs...`);

  for (const id of ids) {
    const fileUrl = `https://drive.google.com/file/d/${id}/view`;

    try {
      const response = await axios.get<string>(fileUrl, {
        headers: { "User-Agent": USER_AGENT },
        validateStatus: () => true,
        timeout: 10000,
      });

      if (response.status >= 200 && response.status < 300) {
        const title = parseTitleFromHtml(response.data);
        if (title && title.length > 0) {
          const mimeType = inferMimeTypeFromName(title);
          validFiles.push({
            id,
            name: title,
            mimeType,
            viewUrl: fileUrl,
            downloadUrl: `https://drive.google.com/uc?export=download&id=${id}`,
          });
          console.log(`[publicScrape] ✓ File verified: "${title}" (${id})`);
        } else {
          console.log(`[publicScrape] ✗ File ID ${id} - could not parse title`);
        }
      } else {
        console.log(`[publicScrape] ✗ File ID ${id} - HTTP ${response.status}`);
      }
    } catch (error) {
      console.log(`[publicScrape] ✗ File ID ${id} - request failed`);
    }
  }

  console.log(
    `[publicScrape] File verification complete: ${validFiles.length} valid files`
  );

  return validFiles;
}

// ============================================================================
// HELPER: Find the "big data" script block
// ============================================================================

interface BigBlockResult {
  bigScriptBlock: string;
  bigBlockEndIndex: number;
}

function findBigScriptBlock(html: string): BigBlockResult | null {
  const marker = "// Google Inc.";
  const endMarker = "</script></div>";

  // Find all occurrences of "// Google Inc."
  const occurrences: number[] = [];
  let searchStart = 0;

  while (true) {
    const idx = html.indexOf(marker, searchStart);
    if (idx === -1) break;
    occurrences.push(idx);
    searchStart = idx + marker.length;
  }

  console.log(
    `[publicScrape] Found ${occurrences.length} occurrences of "${marker}"`
  );

  if (occurrences.length === 0) {
    return null;
  }

  // For each occurrence, find the next "</script></div>" and compute chunk length
  interface Candidate {
    startIdx: number;
    endIdx: number;
    length: number;
  }

  const candidates: Candidate[] = [];

  for (const startIdx of occurrences) {
    const endIdx = html.indexOf(endMarker, startIdx);
    if (endIdx !== -1) {
      const fullEndIdx = endIdx + endMarker.length;
      candidates.push({
        startIdx,
        endIdx: fullEndIdx,
        length: fullEndIdx - startIdx,
      });
    }
  }

  if (candidates.length === 0) {
    console.log(
      `[publicScrape] No valid script blocks found (no "${endMarker}" after markers)`
    );
    return null;
  }

  // Choose the candidate with the largest length
  let largest = candidates[0];
  for (const c of candidates) {
    if (c.length > largest.length) {
      largest = c;
    }
  }

  console.log(
    `[publicScrape] Selected big script block: ${largest.length} chars (from ${largest.startIdx} to ${largest.endIdx})`
  );

  return {
    bigScriptBlock: html.substring(largest.startIdx, largest.endIdx),
    bigBlockEndIndex: largest.endIdx,
  };
}

// ============================================================================
// MAIN FUNCTION: scrapePublicFolder
// ============================================================================

export async function scrapePublicFolder(
  folderId: string
): Promise<PublicScrapeResult> {
  const url = `https://drive.google.com/drive/folders/${folderId}`;

  console.log(`[publicScrape] Fetching folder: ${url}`);

  // -------------------------------------------------------------------------
  // STEP 1: Fetch the folder HTML
  // -------------------------------------------------------------------------
  let html: string;

  try {
    const response = await axios.get<string>(url, {
      headers: { "User-Agent": USER_AGENT },
      validateStatus: () => true,
      timeout: 30000,
    });

    if (response.status === 404) {
      throw new FolderNotFoundError(`Folder ${folderId} not found (404)`);
    }

    if (response.status === 403) {
      throw new PublicAccessForbiddenError(
        `Folder ${folderId} access forbidden (403)`
      );
    }

    if (response.status >= 400) {
      throw new PublicAccessForbiddenError(
        `Folder ${folderId} returned HTTP ${response.status}`
      );
    }

    html = response.data;
    console.log(`[publicScrape] Received HTML: ${html.length} chars`);
  } catch (error) {
    if (
      error instanceof FolderNotFoundError ||
      error instanceof PublicAccessForbiddenError
    ) {
      throw error;
    }
    console.log(`[publicScrape] Network error fetching folder:`, error);
    throw new FolderNotFoundError(`Could not fetch folder ${folderId}`);
  }

  // -------------------------------------------------------------------------
  // STEP 2: Find the big script block
  // -------------------------------------------------------------------------
  const blockResult = findBigScriptBlock(html);

  if (!blockResult) {
    console.log(
      "[publicScrape] Could not find big script block - parse failure"
    );
    return { files: [], isEmptyFolder: false };
  }

  const { bigScriptBlock, bigBlockEndIndex } = blockResult;

  // -------------------------------------------------------------------------
  // STEP 3: Extract IDs from the big block (potential subfolders/first file)
  // -------------------------------------------------------------------------
  const candidateIdsInBlock = parseIdsFromBlock(bigScriptBlock);
  const uniqueBlockIds = Array.from(new Set(candidateIdsInBlock));

  console.log(
    `[publicScrape] Big block: ${candidateIdsInBlock.length} raw IDs → ${uniqueBlockIds.length} unique`
  );

  // -------------------------------------------------------------------------
  // STEP 4: Extract IDs from the tail HTML (after the big block)
  // -------------------------------------------------------------------------
  const tailHtml = html.slice(bigBlockEndIndex);
  const candidateIdsInTail = parseIdsFromBlock(tailHtml);
  const uniqueTailIds = Array.from(new Set(candidateIdsInTail));

  console.log(
    `[publicScrape] Tail HTML: ${candidateIdsInTail.length} raw IDs → ${uniqueTailIds.length} unique`
  );

  // -------------------------------------------------------------------------
  // STEP 5: Verify block IDs as folders
  // -------------------------------------------------------------------------
  const { validFolders, invalidIds: invalidFolderIds, detectedFiles } =
    await verifyFolderIds(uniqueBlockIds);

  // -------------------------------------------------------------------------
  // STEP 6: Build file candidate set
  // -------------------------------------------------------------------------
  const allFileCandidateIds = new Set<string>();

  // If no valid folders were found, treat block IDs as potential file IDs
  if (validFolders.length === 0) {
    for (const id of uniqueBlockIds) {
      allFileCandidateIds.add(id);
    }
    console.log(
      `[publicScrape] No valid folders in block → treating ${uniqueBlockIds.length} block IDs as file candidates`
    );
  } else {
    // Some block IDs were not valid folders - they might be files (first file ID case)
    for (const id of invalidFolderIds) {
      allFileCandidateIds.add(id);
    }
    if (invalidFolderIds.length > 0) {
      console.log(
        `[publicScrape] ${invalidFolderIds.length} invalid folder IDs added to file candidates`
      );
    }
  }

  // All tail IDs are potential files
  for (const id of uniqueTailIds) {
    allFileCandidateIds.add(id);
  }

  console.log(
    `[publicScrape] Total file candidates: ${allFileCandidateIds.size}`
  );

  // -------------------------------------------------------------------------
  // STEP 7: Verify file candidates
  // -------------------------------------------------------------------------
  const validFiles = await verifyFileIds(Array.from(allFileCandidateIds));

  // -------------------------------------------------------------------------
  // STEP 8: Combine results
  // -------------------------------------------------------------------------
  const files: DriveFile[] = [...validFolders, ...detectedFiles, ...validFiles];

  console.log(
    `[publicScrape] Final result: ${validFolders.length} folders + ${detectedFiles.length} detected files + ${validFiles.length} verified files = ${files.length} total items`
  );

  // Determine if folder is empty
  // isEmptyFolder = true only if we successfully parsed but found no items
  const isEmptyFolder = files.length === 0;

  return { files, isEmptyFolder };
}

