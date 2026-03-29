import mongoose from "mongoose";

const ragChunkSchema = new mongoose.Schema(
  {
    ragContextId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RagContext",
      required: true,
      index: true,
    },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
  },
  { timestamps: true }
);

// Compound index for fast lookup: all chunks for a given ragContext, ordered
ragChunkSchema.index({ ragContextId: 1, chunkIndex: 1 });

export const RagChunk = mongoose.model("RagChunk", ragChunkSchema);
