import mongoose from "mongoose";

const dynamicDataSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    googleSheetUrl: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      default: "",
    },
    lastSyncedAt: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

dynamicDataSchema.index({ createdBy: 1 });

export const DynamicData = mongoose.model("DynamicData", dynamicDataSchema);
