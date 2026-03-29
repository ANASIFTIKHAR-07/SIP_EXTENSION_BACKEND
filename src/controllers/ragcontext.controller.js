import { v2 as cloudinary } from "cloudinary";
import OpenAI from "openai";
import { RagContext } from "../models/ragcontext.model.js";
import { RagChunk } from "../models/ragchunk.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_CHARS = 200000; // increased limit — chunking handles large docs now
const CHUNK_SIZE = 500;   // characters per chunk
const CHUNK_OVERLAP = 50; // overlap between consecutive chunks

// ── Chunking ─────────────────────────────────────────────────────────────────
function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = start + chunkSize;

    // Try to break at a sentence boundary (. ! ? ۔ ؟) or newline
    if (end < text.length) {
      const slice = text.slice(start, end + 100); // look ahead a bit
      const breakMatch = slice.match(/[.!?۔؟\n]\s/g);
      if (breakMatch) {
        // Find the LAST sentence break within our window
        let lastBreak = -1;
        let searchFrom = 0;
        for (const m of slice.matchAll(/[.!?۔؟\n]\s/g)) {
          if (m.index >= chunkSize - 100) { // only break near the end of the chunk
            if (lastBreak === -1) lastBreak = m.index + m[0].length;
          }
          lastBreak = m.index + m[0].length;
        }
        if (lastBreak > chunkSize * 0.5) {
          end = start + lastBreak;
        }
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    start = end - overlap;
  }
  return chunks;
}

// ── Embedding ────────────────────────────────────────────────────────────────
async function embedChunks(chunks) {
  // OpenAI supports batched embedding — send all chunks in one API call
  // For very large docs (500+ chunks), batch in groups of 100
  const allEmbeddings = [];
  const BATCH_SIZE = 100;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });
    for (const item of response.data) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

// ── Upload ───────────────────────────────────────────────────────────────────
const uploadRagFile = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No file uploaded");

  const { mimetype, originalname, buffer } = req.file;
  const allowed = ["application/pdf", "text/plain"];
  if (!allowed.includes(mimetype))
    throw new ApiError(400, "Only PDF and TXT files are supported");

  let extractedText = "";
  if (mimetype === "application/pdf") {
    // Dynamically require pdf-parse ONLY on upload to prevent fatal crashes and DOMMatrix/Canvas polyfill warnings on server startup in Node 18/Ubuntu
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const pdfParse = require("pdf-parse");

    const parsed = await pdfParse(buffer);
    extractedText = parsed.text;
  } else {
    extractedText = buffer.toString("utf-8");
  }

  extractedText = extractedText.trim().slice(0, MAX_CHARS);
  if (!extractedText) throw new ApiError(422, "Could not extract text from file");

  // Upload original file to Cloudinary for storage
  const cloudinaryUrl = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "raw", folder: "rag-context", use_filename: true },
      (err, result) => (err ? reject(err) : resolve(result.secure_url)),
    );
    stream.end(buffer);
  });

  // Deactivate all other documents for this user
  await RagContext.updateMany({ uploadedBy: req.user._id }, { isActive: false });

  // Create the RagContext document (still stores extractedText for edit/preview)
  const doc = await RagContext.create({
    fileName: originalname,
    cloudinaryUrl,
    extractedText,
    isActive: true,
    uploadedBy: req.user._id,
  });

  // ── Chunk + Embed pipeline ───────────────────────────────────────────────
  const chunks = chunkText(extractedText);
  console.log(`📄 Chunked "${originalname}" into ${chunks.length} chunks`);

  const embeddings = await embedChunks(chunks);
  console.log(`🧠 Embedded ${embeddings.length} chunks via text-embedding-3-small`);

  // Bulk insert all chunks
  const chunkDocs = chunks.map((text, i) => ({
    ragContextId: doc._id,
    chunkIndex: i,
    text,
    embedding: embeddings[i],
  }));
  await RagChunk.insertMany(chunkDocs);
  console.log(`💾 Stored ${chunkDocs.length} chunks in MongoDB`);

  return res.status(201).json(new ApiResponse(201, doc, "RAG file uploaded, chunked, and embedded"));
});

// ── List all ─────────────────────────────────────────────────────────────────
const getAllRagFiles = asyncHandler(async (req, res) => {
  const docs = await RagContext.find({ uploadedBy: req.user._id })
    .select("-extractedText")
    .sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(200, docs, "RAG files fetched"));
});

// ── Get active ───────────────────────────────────────────────────────────────
const getActiveRagFile = asyncHandler(async (req, res) => {
  const doc = await RagContext.findOne({ uploadedBy: req.user._id, isActive: true });
  if (!doc) throw new ApiError(404, "No active RAG context");
  return res.status(200).json(new ApiResponse(200, doc, "Active RAG context"));
});

// ── Get by ID ────────────────────────────────────────────────────────────────
const getRagFileById = asyncHandler(async (req, res) => {
  const doc = await RagContext.findOne({ _id: req.params.id, uploadedBy: req.user._id });
  if (!doc) throw new ApiError(404, "RAG file not found");
  return res.status(200).json(new ApiResponse(200, doc, "RAG file fetched"));
});

// ── Activate ─────────────────────────────────────────────────────────────────
const activateRagFile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doc = await RagContext.findOne({ _id: id, uploadedBy: req.user._id });
  if (!doc) throw new ApiError(404, "RAG file not found");

  await RagContext.updateMany({ uploadedBy: req.user._id }, { isActive: false });
  doc.isActive = true;
  await doc.save();

  return res.status(200).json(new ApiResponse(200, doc, "RAG file activated"));
});

// ── Update text (re-chunks + re-embeds) ──────────────────────────────────────
const updateRagText = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { extractedText } = req.body;
  if (!extractedText?.trim()) throw new ApiError(400, "extractedText is required");

  const doc = await RagContext.findOne({ _id: id, uploadedBy: req.user._id });
  if (!doc) throw new ApiError(404, "RAG file not found");

  doc.extractedText = extractedText.trim().slice(0, MAX_CHARS);
  await doc.save();

  // Re-chunk and re-embed since the text changed
  await RagChunk.deleteMany({ ragContextId: doc._id });
  const chunks = chunkText(doc.extractedText);
  const embeddings = await embedChunks(chunks);
  const chunkDocs = chunks.map((text, i) => ({
    ragContextId: doc._id,
    chunkIndex: i,
    text,
    embedding: embeddings[i],
  }));
  await RagChunk.insertMany(chunkDocs);
  console.log(`🔄 Re-chunked and re-embedded "${doc.fileName}" → ${chunkDocs.length} chunks`);

  return res.status(200).json(new ApiResponse(200, doc, "RAG text updated and re-embedded"));
});

// ── Delete (also deletes chunks) ─────────────────────────────────────────────
const deleteRagFile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doc = await RagContext.findOne({ _id: id, uploadedBy: req.user._id });
  if (!doc) throw new ApiError(404, "RAG file not found");

  await RagChunk.deleteMany({ ragContextId: doc._id });
  await RagContext.findByIdAndDelete(id);

  return res.status(200).json(new ApiResponse(200, null, "RAG file and chunks deleted"));
});

// ── Reprocess existing document (for migration) ──────────────────────────────
const reprocessRagFile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doc = await RagContext.findOne({ _id: id, uploadedBy: req.user._id });
  if (!doc) throw new ApiError(404, "RAG file not found");
  if (!doc.extractedText?.trim()) throw new ApiError(422, "No text to process");

  // Delete old chunks if any
  await RagChunk.deleteMany({ ragContextId: doc._id });

  // Re-chunk and embed
  const chunks = chunkText(doc.extractedText);
  const embeddings = await embedChunks(chunks);
  const chunkDocs = chunks.map((text, i) => ({
    ragContextId: doc._id,
    chunkIndex: i,
    text,
    embedding: embeddings[i],
  }));
  await RagChunk.insertMany(chunkDocs);
  console.log(`🔄 Reprocessed "${doc.fileName}" → ${chunkDocs.length} chunks`);

  return res.status(200).json(new ApiResponse(200, { chunksCreated: chunkDocs.length }, "RAG file reprocessed"));
});

export {
  uploadRagFile,
  getAllRagFiles,
  getActiveRagFile,
  getRagFileById,
  activateRagFile,
  updateRagText,
  deleteRagFile,
  reprocessRagFile,
};
