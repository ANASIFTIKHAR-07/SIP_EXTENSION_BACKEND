import mongoose, { Schema } from "mongoose";

const sipSchema = new Schema(
    {
        domain: {
            type: String,
            required: [true, "SIP domain is required"],
            trim: true,
            lowercase: true,
        },
        extensionUsername: {
            type: String,
            required: [true, "Extension username is required"],
            trim: true,
        },
        password: {
            type: String,
            required: [true, "Password is required"],
            minLength: [6, "At least 6 characters required"],
        },
        extension: {
            type: String,
            required: [true, "Extension is required"],
            trim: true,
        },
        user: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: [true, "User reference is required"],
        },
        pbx: {
            type: String,
            trim: true,
            default: null,
        },
        displayName: {
            type: String,
            trim: true,
            default: null,
        },
    },
    { timestamps: true }
);

export const Sip = mongoose.model("Sip", sipSchema);