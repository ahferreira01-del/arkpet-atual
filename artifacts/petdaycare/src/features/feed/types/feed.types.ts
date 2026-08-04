// ─────────────────────────────────────────────────────────────────────────────
// Feed V2 — Domain Types
// ─────────────────────────────────────────────────────────────────────────────

export type FeedEventType =
  | "photo"
  | "video"
  | "note"
  | "play"
  | "walk"
  | "feeding"
  | "medication"
  | "health"
  | "check_in"
  | "check_out";

export type MediaType = "photo" | "video";

/**
 * A single media item in a post.
 * V2 supports exactly one item; the array structure is ready for carousels /
 * multiple media in a future version without breaking changes.
 */
export interface MediaItem {
  /** Raw object-storage path, e.g. "/objects/uploads/uuid.webp" */
  objectPath: string;
  type: MediaType;
  /** Position in future carousels. V2 always 0. */
  order: number;
}

export interface PostAuthor {
  id: number;
  name: string;
}

export interface PostPet {
  petId: number;
  petName: string;
  petPhoto?: string | null;
}

/** Full feed post DTO returned by the API */
export interface FeedPost {
  id: number;
  type: FeedEventType;
  content: string | null;
  /** Array designed for future multi-media support. V2 has 0 or 1 items. */
  mediaItems: MediaItem[];
  author: PostAuthor;
  pets: PostPet[];
  createdAt: string; // ISO-8601
  likeCount: number;
  commentCount: number;
  viewCount: number;
  isLiked: boolean;
}

export interface FeedComment {
  id: number;
  eventId: number;
  userId: number;
  userName: string | null;
  content: string;
  createdAt: string;
}

/** Response shape from GET /feed */
export interface FeedPage {
  posts: FeedPost[];
  nextCursor: number | null;
}

/** Payload for creating a new post */
export interface CreatePostPayload {
  type: FeedEventType;
  content: string | null;
  mediaUrl: string | null;
  mediaType: MediaType | null;
  petIds: number[];
}

/** Result from the media validation utility */
export interface MediaValidationResult {
  valid: boolean;
  error?: string;
}

/** A pet available for tagging (checked-in pets only) */
export interface TaggablePet {
  id: number;
  name: string;
  breed: string | null;
  species: string | null;
}
