import { AIAgent } from "../models/aiagent.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import fs from "fs";
import path from "path";

// GET /api/v1/ai-agents
const getAllAgents = asyncHandler(async (req, res) => {
  const agents = await AIAgent.find({ createdBy: req.user._id }).sort({ createdAt: -1 });
  return res.status(200).json(new ApiResponse(200, agents, "Agents fetched successfully"));
});

// POST /api/v1/ai-agents
const createAgent = asyncHandler(async (req, res) => {
  const { name, purpose, modelProvider, modelName, systemPrompt } = req.body;

  if (!name || !purpose) {
    throw new ApiError(400, "name and purpose are required");
  }

  const agent = await AIAgent.create({
    name,
    purpose,
    modelProvider: modelProvider || "openai",
    modelName: modelName || "gpt-4o",
    systemPrompt: systemPrompt || "",
    createdBy: req.user._id,
  });

  return res.status(201).json(new ApiResponse(201, agent, "Agent created successfully"));
});

// PATCH /api/v1/ai-agents/:id
const updateAgent = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, purpose, modelProvider, modelName, systemPrompt, isActive } = req.body;

  const agent = await AIAgent.findOne({ _id: id, createdBy: req.user._id });
  if (!agent) throw new ApiError(404, "Agent not found or unauthorized");

  if (name !== undefined) agent.name = name;
  if (purpose !== undefined) agent.purpose = purpose;
  if (modelProvider !== undefined) agent.modelProvider = modelProvider;
  if (modelName !== undefined) agent.modelName = modelName;
  if (systemPrompt !== undefined) agent.systemPrompt = systemPrompt;
  if (isActive !== undefined) agent.isActive = isActive;

  await agent.save();

  return res.status(200).json(new ApiResponse(200, agent, "Agent updated successfully"));
});

// DELETE /api/v1/ai-agents/:id
const deleteAgent = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const agent = await AIAgent.findOne({ _id: id, createdBy: req.user._id });
  if (!agent) throw new ApiError(404, "Agent not found or unauthorized");

  await AIAgent.findByIdAndDelete(id);

  return res.status(200).json(new ApiResponse(200, null, "Agent deleted successfully"));
});

// POST /api/v1/ai-agents/:id/rag-files
const addRagFile = asyncHandler(async (req, res) => {
  const { id } = req.params;

  console.log("File upload request:", { file: req.file, body: req.body });

  if (!req.file) throw new ApiError(400, "File is required");

  const agent = await AIAgent.findOne({ _id: id, createdBy: req.user._id });
  if (!agent) throw new ApiError(404, "Agent not found or unauthorized");

  const fileUrl = `/uploads/${req.file.filename}`;
  const fileContent = fs.readFileSync(req.file.path, "utf-8");

  agent.ragFiles.push({ 
    fileName: req.file.originalname, 
    fileUrl,
    content: fileContent
  });
  await agent.save();

  return res.status(200).json(new ApiResponse(200, agent, "RAG file added successfully"));
});

// DELETE /api/v1/ai-agents/:id/rag-files/:fileId
const removeRagFile = asyncHandler(async (req, res) => {
  const { id, fileId } = req.params;

  const agent = await AIAgent.findOne({ _id: id, createdBy: req.user._id });
  if (!agent) throw new ApiError(404, "Agent not found or unauthorized");

  const file = agent.ragFiles.find((f) => f._id.toString() === fileId);
  if (file && file.fileUrl) {
    const filePath = path.join(process.cwd(), file.fileUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  agent.ragFiles = agent.ragFiles.filter((f) => f._id.toString() !== fileId);
  await agent.save();

  return res.status(200).json(new ApiResponse(200, agent, "RAG file removed successfully"));
});

export { getAllAgents, createAgent, updateAgent, deleteAgent, addRagFile, removeRagFile };
