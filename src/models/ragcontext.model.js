import mongoose from "mongoose";

const ragContextSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    cloudinaryUrl: { type: String, required: true },
    extractedText: { type: String, required: true },
    isActive: { type: Boolean, default: false },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

export const RagContext = mongoose.model("RagContext", ragContextSchema);
