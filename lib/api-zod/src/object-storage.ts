// Object storage schemas (hand-written; not generated from the OpenAPI spec).
import { z } from "zod";

export const RequestUploadUrlBody = z.object({
  name: z.string(),
  size: z.number().max(5 * 1024 * 1024, "Tamanho mximo permitido  de 5MB."),
  contentType: z.string(),
});

export const RequestUploadUrlResponse = z.object({
  uploadURL: z.string(),
  objectPath: z.string(),
  metadata: z.object({
    name: z.string(),
    size: z.number(),
    contentType: z.string(),
  }),
});
