import mongoose from "mongoose";

const callLogSchema = new mongoose.Schema(
    {
        callId: {
            type: String,
            required: true,
            unique: true,
        },
        extension: {
            type: String,
            required: true,
        },
        fromNumber: {
            type: String,
            required: true,
        },
        toNumber: {
            type: String,
            required: true,
        },
        remoteIp: {
            type: String,
        },
        remotePort: {
            type: Number,
        },
        status: {
            type: String,
            enum: ["active", "ended", "failed"],
            default: "active",
        },
        botEnabled: {
            type: Boolean,
            default: true,
        },
        startedAt: {
            type: Date,
            default: Date.now,
        },
        endedAt: {
            type: Date,
            default: null,
        },
        durationSeconds: {
            type: Number,
            default: null,
        },
    },
    { timestamps: true }
);

export const CallLog = mongoose.model("CallLog", callLogSchema);