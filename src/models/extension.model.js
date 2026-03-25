import mongoose from "mongoose";

const sipExtensionSchema = new mongoose.Schema(
    {
        extension: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        password: {
            type: String,
            required: true,
        },
        domain: {
            type: String,
            required: true,
            trim: true,
        },
        displayName: {
            type: String,
            trim: true,
        },
        isRegistered: {
            type: Boolean,
            default: false,
        },
        registeredAt: {
            type: Date,
            default: null,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        aiAgent: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AIAgent",
            default: null,
        },
    },
    { timestamps: true }
);

export const SipExtension = mongoose.model("SipExtension", sipExtensionSchema);