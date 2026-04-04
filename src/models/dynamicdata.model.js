import mongoose from "mongoose";

const dynamicDataSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    sourceType: {
      type: String,
      enum: ['google_sheet', 'file'],
      default: 'google_sheet'
    },
    googleSheetUrl: {
      type: String,
      required: function() { return this.sourceType === 'google_sheet'; }
    },
    fileName: {
      type: String,
      required: function() { return this.sourceType === 'file'; }
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
