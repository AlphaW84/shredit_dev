import { z } from "zod";
import { decodeBase64Url, isValidNoteId } from "@/lib/crypto/base64url";
import { validatePassword } from "@/lib/crypto/password";
import { EXPIRY_VALUES } from "@/lib/validation/values";

const strictBase64Url = (label: string) =>
  z
    .string()
    .min(1)
    .refine((value) => {
      try {
        decodeBase64Url(value);
        return true;
      } catch {
        return false;
      }
    }, `${label} must be canonical base64url`);

export const expiresInSchema = z.enum(EXPIRY_VALUES);

export const createNoteSchema = z
  .object({
    id: z
      .string()
      .refine(isValidNoteId, "id must be a canonical 24-byte note ID"),
    protocolVersion: z.literal(1),
    iv: strictBase64Url("iv").refine((value) => {
      try {
        return decodeBase64Url(value, 12).byteLength === 12;
      } catch {
        return false;
      }
    }, "iv must be 12 bytes"),
    ciphertext: strictBase64Url("ciphertext").refine((value) => {
      try {
        const bytes = decodeBase64Url(value);
        return bytes.byteLength >= 16 && bytes.byteLength <= 65_552;
      } catch {
        return false;
      }
    }, "ciphertext size is invalid"),
    expiresIn: expiresInSchema.default("7d"),
    password: z
      .string()
      .refine(validatePassword, "password format is invalid")
      .optional(),
    turnstileToken: z.string().min(1).optional(),
    pow: z
      .object({ challenge: z.string().min(1), nonce: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();

export const openNoteSchema = z
  .object({
    password: z
      .string()
      .refine(validatePassword, "password format is invalid")
      .optional(),
  })
  .strict();

export const powChallengeSchema = z
  .object({
    surface: z.literal("onion"),
    payloadDigest: strictBase64Url("payloadDigest").refine((value) => {
      try {
        return decodeBase64Url(value, 32).byteLength === 32;
      } catch {
        return false;
      }
    }, "payloadDigest must be 32 bytes"),
  })
  .strict();

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type OpenNoteInput = z.infer<typeof openNoteSchema>;
