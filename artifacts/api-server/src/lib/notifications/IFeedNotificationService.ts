/**
 * Domain event emitted after a feed post is successfully persisted.
 * The notification service receives this and dispatches push notifications
 * asynchronously — callers must not await the result.
 */
export interface FeedPublishedEvent {
  readonly postId: number;
  readonly type: string;
  readonly authorName: string;
  readonly crecheId: number;
  /** IDs of all pets tagged in the post */
  readonly petIds: number[];
}

/**
 * Notification service interface for feed events.
 *
 * The feed route depends only on this interface. Swap the concrete
 * implementation (e.g. to BullMQ, RabbitMQ, SQS) without touching any
 * feed logic.
 */
export interface IFeedNotificationService {
  /**
   * Notify tutors that a new post was published.
   * Implementations MUST be fire-and-forget (void return).
   * Errors MUST be caught and logged internally — they must never propagate
   * to the caller or affect the HTTP response.
   */
  onPostPublished(event: FeedPublishedEvent): void;
}
