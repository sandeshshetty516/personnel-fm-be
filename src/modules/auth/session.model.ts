import { model, Schema, Types, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * One document per refresh token. Rotation revokes the presented token and issues a new one in the
 * same family; presenting an already-rotated token revokes the whole family (likely token theft).
 */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // SHA-256 of the opaque refresh token; the raw token only ever exists in the cookie.
    tokenHash: { type: String, required: true },
    familyId: { type: Schema.Types.ObjectId, required: true, default: () => new Types.ObjectId() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: Schema.Types.ObjectId, ref: 'Session' },
    userAgent: { type: String, maxlength: 512 },
    ip: { type: String, maxlength: 64 },
  },
  { timestamps: true },
);

sessionSchema.index({ tokenHash: 1 }, { unique: true });
sessionSchema.index({ userId: 1, revokedAt: 1 });
sessionSchema.index({ familyId: 1 });
// MongoDB removes sessions automatically once they expire.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type Session = InferSchemaType<typeof sessionSchema>;
export type SessionDocument = HydratedDocument<Session>;

export const SessionModel = model('Session', sessionSchema);
