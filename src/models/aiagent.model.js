import mongoose from "mongoose";

const ragFileSchema = new mongoose.Schema({
  fileName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  content: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
});

const aiAgentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    purpose: {
      type: String,
      enum: ["customer_support", "sales", "receptionist", "appointment_booking", "faq", "custom"],
      required: true,
    },
    modelProvider: {
      type: String,
      enum: ["openai", "anthropic", "google"],
      default: "openai",
    },
    modelName: {
      type: String,
      default: "gpt-4o",
    },
    systemPrompt: { type: String, default: "" },
    ragFiles: [ragFileSchema],
    isActive: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

export const AIAgent = mongoose.model("AIAgent", aiAgentSchema);
