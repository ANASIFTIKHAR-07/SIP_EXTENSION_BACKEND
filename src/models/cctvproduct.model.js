import mongoose from "mongoose";

const cctvProductSchema = new mongoose.Schema(
  {
    brand: {
      type: String,
      required: true,
      trim: true,
    },
    model: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["dome", "bullet", "ptz", "nvr", "dvr", "turret", "speed_dome", "package"],
      required: true,
    },
    resolution: {
      type: String,
      trim: true,
    },
    features: [{ type: String }],
    priceMin: {
      type: Number,
      required: true,
    },
    priceMax: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Compound index for fast lookups
cctvProductSchema.index({ createdBy: 1, isActive: 1 });
cctvProductSchema.index({ brand: 1, category: 1 });

export const CctvProduct = mongoose.model("CctvProduct", cctvProductSchema);
