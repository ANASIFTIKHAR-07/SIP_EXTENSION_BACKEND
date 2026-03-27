import mongoose from "mongoose";

const rateLimitSchema = new mongoose.Schema(
  {
    extensionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SipExtension",
      required: true,
      unique: true,
    },
    chatgpt: {
      maxTokensPerCall: { type: Number, default: 1000, min: 0 },
      maxTokensPerMinute: { type: Number, default: 5000, min: 0 },
      maxTokensPerHour: { type: Number, default: 50000, min: 0 },
    },
    deepgram: {
      maxTokensPerCall: { type: Number, default: 1000, min: 0 },
      maxTokensPerMinute: { type: Number, default: 5000, min: 0 },
      maxTokensPerHour: { type: Number, default: 50000, min: 0 },
    },
    warningThreshold: { type: Number, default: 80, min: 0, max: 100 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

export const RateLimit = mongoose.model("RateLimit", rateLimitSchema);
