import { v2 as cloudinary } from "cloudinary";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { RagContext } from "../models/ragcontext.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const MAX_CHARS = 32000; 

const uploadRagFile = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No file uploaded");

  const { mimetype, originalname, buffer } = req.file;
  const allowed = ["application/pdf", "text/plain"];
  if (!allowed.includes(mimetype))
    throw new ApiError(400, "Only PDF and TXT files are supported");

  let extractedText = "";
  if (mimetype === "application/pdf") {
    const parsed = await pdfParse(buffer);
    extractedText = parsed.text;
  } else {
    extractedText = buffer.toString("utf-8");
  }

  extractedText = extractedText.trim().slice(0, MAX_CHARS);
  if (!extractedText) throw new ApiError(422, "Could not extract text from file");

  const cloudinaryUrl = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "raw", folder: "rag-context", use_filename: true },
      (err, result) => (err ? reject(err) : resolve(result.secure_url)),
    );
    stream.end(buffer);
  });

  await RagContext.updateMany({ uploadedBy: req.user._id }, { isActive: false });

  const doc = await RagContext.create({
    fileName: originalname,
    cloudinaryUrl,
    extractedText,
    isActive: true,
    uploadedBy: req.user._id,
  });

  return res.status(201).json(new ApiResponse(201, doc, "RAG file uploaded and set as active"));
});

const getAllRagFiles = asyncHandler(async (req, res) => {
  const docs = await RagContext.find({ uploadedBy: req.user._id })
    .select("-extractedText")
    .sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(200, docs, "RAG files fetched"));
});

const getActiveRagFile = asyncHandler(async (req, res) => {
  const doc = await RagContext.findOne({ uploadedBy: req.user._id, isActive: true });
  if (!doc) throw new ApiError(404, "No active RAG context");
  return res.status(200).json(new ApiResponse(200, doc, "Active RAG context"));
});

const getRagFileById = asyncHandler(async (req, res) => {
  const doc = await RagContext.findOne({ _id: req.params.id, uploadedBy: req.user._id });
  if (!doc) throw new ApiError(404, "RAG file not found");
  return res.status(200).json(new ApiResponse(200, doc, "RAG file fetched"));
});

const activateRagFile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doc = await RagContext.findOne({ _id: id, uploadedBy: req.user._id });
  if (!doc) throw new ApiError(404, "RAG file not found");

  await RagContext.updateMany({ uploadedBy: req.user._id }, { isActive: false });
  doc.isActive = true;
  await doc.save();

  return res.status(200).json(new ApiResponse(200, doc, "RAG file activated"));
});

const updateRagText = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { extractedText } = req.body;
  if (!extractedText?.trim()) throw new ApiError(400, "extractedText is required");

  const doc = await RagContext.findOne({ _id: id, uploadedBy: req.user._id });
  if (!doc) throw new ApiError(404, "RAG file not found");

  doc.extractedText = extractedText.trim().slice(0, MAX_CHARS);
  await doc.save();

  return res.status(200).json(new ApiResponse(200, doc, "RAG text updated"));
});

const deleteRagFile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doc = await RagContext.findOne({ _id: id, uploadedBy: req.user._id });
  if (!doc) throw new ApiError(404, "RAG file not found");

  await RagContext.findByIdAndDelete(id);

  return res.status(200).json(new ApiResponse(200, null, "RAG file deleted"));
});

export {
  uploadRagFile,
  getAllRagFiles,
  getActiveRagFile,
  getRagFileById,
  activateRagFile,
  updateRagText,
  deleteRagFile,
};
