import type { FeedPost, FeedEventType, MediaType, CreatePostPayload } from "../types/feed.types";
import { validateMediaFile, getMediaType, compressToWebPBlob, uploadToStorage } from "./upload.service";
import { createPost } from "../api/feed.api";

export interface CreatePostInput {
  content: string;
  mediaFile: File | null;
  petIds: number[];
}

export interface CreatePostProgress {
  stage: "validating" | "uploading" | "saving" | "done";
  uploadPercent?: number;
}

export type ProgressCallback = (progress: CreatePostProgress) => void;

/**
 * Orchestrates the full post-creation flow:
 * 1. Validate media (if present)
 * 2. Compress photo to WebP blob (if photo)
 * 3. Upload blob to object storage
 * 4. POST /feed with the returned objectPath
 * 5. Return the full FeedPost DTO
 */
export async function publishPost(
  crecheId: number,
  input: CreatePostInput,
  token: string,
  onProgress?: ProgressCallback,
): Promise<FeedPost> {
  const { content, mediaFile, petIds } = input;

  let mediaUrl: string | null = null;
  let mediaType: MediaType | null = null;
  let resolvedType: FeedEventType = "note";

  if (mediaFile) {
    onProgress?.({ stage: "validating" });

    const validation = await validateMediaFile(mediaFile);
    if (!validation.valid) {
      throw new Error(validation.error ?? "Arquivo inválido");
    }

    const detectedType = getMediaType(mediaFile);
    if (!detectedType) throw new Error("Tipo de arquivo não suportado");

    mediaType   = detectedType;
    resolvedType = detectedType === "video" ? "video" : "photo";

    let uploadBlob: Blob;
    let uploadContentType: string;

    if (detectedType === "photo") {
      // Compress to WebP before upload
      uploadBlob = await compressToWebPBlob(mediaFile);
      uploadContentType = "image/webp";
    } else {
      // Video: upload directly without browser-side conversion
      uploadBlob = mediaFile;
      uploadContentType = mediaFile.type;
    }

    onProgress?.({ stage: "uploading", uploadPercent: 0 });

    const uploaded = await uploadToStorage(uploadBlob, uploadContentType, token, crecheId, (pct) => {
      onProgress?.({ stage: "uploading", uploadPercent: pct });
    });

    mediaUrl = uploaded.objectPath;
  }

  onProgress?.({ stage: "saving" });

  const payload: CreatePostPayload = {
    type:      resolvedType,
    content:   content.trim() || null,
    mediaUrl,
    mediaType,
    petIds,
  };

  const { post } = await createPost(crecheId, payload, token);

  onProgress?.({ stage: "done" });

  return post;
}
