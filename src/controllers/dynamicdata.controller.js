import { DynamicData } from "../models/dynamicdata.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Extracts the sheet ID from standard google sheet URLs
const extractSheetId = (url) => {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
};

// Fetches the CSV content directly from Google Sheets
const fetchSheetCsv = async (sheetId) => {
  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  try {
    const response = await fetch(exportUrl);
    if (!response.ok) {
      throw new Error(`Google Sheets responded with ${response.status} - Ensure the sheet is Public (Anyone with link).`);
    }
    const text = await response.text();
    return text;
  } catch (err) {
    throw new Error(`Failed to fetch sheet data: ${err.message}`);
  }
};

// @desc    Add a new dynamic sheet and sync its data
// @route   POST /api/v1/dynamic-data
const addDynamicData = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { name, googleSheetUrl } = req.body;

  if (!name || !googleSheetUrl) {
    throw new ApiError(400, "Name and Google Sheet URL are required");
  }

  const sheetId = extractSheetId(googleSheetUrl);
  if (!sheetId) {
    throw new ApiError(400, "Invalid Google Sheet URL. Please ensure it is a valid link.");
  }

  let csvContent = "";
  try {
    csvContent = await fetchSheetCsv(sheetId);
  } catch (err) {
    throw new ApiError(400, err.message);
  }

  if (!csvContent || csvContent.trim().length === 0) {
    throw new ApiError(400, "The fetched sheet appears to be empty.");
  }

  // Pre-process the CSV slightly to make it easily readable for OpenAI
  // Strip empty lines
  const cleanContent = csvContent
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n");

  const newSheet = await DynamicData.create({
    name,
    googleSheetUrl,
    content: cleanContent,
    createdBy: userId,
  });

  return res.status(201).json(new ApiResponse(201, newSheet, "Sheet linked and synchronized successfully"));
});

// @desc    Get all dynamic data for the user
// @route   GET /api/v1/dynamic-data
const getDynamicData = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const data = await DynamicData.find({ createdBy: userId }).select("-content").sort({ updatedAt: -1 });

  return res.status(200).json(new ApiResponse(200, data, "Dynamic data retrieved successfully"));
});

// @desc    Resync an existing dynamic sheet
// @route   POST /api/v1/dynamic-data/:id/sync
const resyncDynamicData = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const sheetDoc = await DynamicData.findOne({ _id: id, createdBy: userId });
  if (!sheetDoc) {
    throw new ApiError(404, "Sheet not found");
  }

  const sheetId = extractSheetId(sheetDoc.googleSheetUrl);
  
  let csvContent = "";
  try {
    csvContent = await fetchSheetCsv(sheetId);
  } catch (err) {
    throw new ApiError(400, err.message);
  }

  const cleanContent = csvContent
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n");

  sheetDoc.content = cleanContent;
  sheetDoc.lastSyncedAt = Date.now();
  await sheetDoc.save();

  return res.status(200).json(new ApiResponse(200, sheetDoc, "Sheet re-synchronized successfully"));
});

// @desc    Delete a dynamic data link
// @route   DELETE /api/v1/dynamic-data/:id
const deleteDynamicData = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const userId = req.user._id;

  const sheetDoc = await DynamicData.findOneAndDelete({ _id: id, createdBy: userId });

  if (!sheetDoc) {
    throw new ApiError(404, "Sheet not found");
  }

  return res.status(200).json(new ApiResponse(200, { deleted: id }, "Sheet removed successfully"));
});

export { addDynamicData, getDynamicData, resyncDynamicData, deleteDynamicData };
