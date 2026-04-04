import { DynamicData } from "../models/dynamicdata.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import xlsx from "xlsx";

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
  
  // if req.file exists, it's a file upload; otherwise check for googleSheetUrl
  const isFileUpload = !!req.file;

  if (!name || (!googleSheetUrl && !isFileUpload)) {
    throw new ApiError(400, "Name and either a Google Sheet URL or a File are required");
  }

  let csvContent = "";
  let sourceType = "google_sheet";
  let fileName = undefined;

  if (isFileUpload) {
    sourceType = "file";
    fileName = req.file.originalname;

    try {
      // Use xlsx to read the buffer
      const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
      // Get the first sheet
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      // Convert to CSV
      csvContent = xlsx.utils.sheet_to_csv(worksheet);
    } catch (err) {
      throw new ApiError(400, `Failed to parse uploaded file: ${err.message}`);
    }
  } else {
    sourceType = "google_sheet";
    const sheetId = extractSheetId(googleSheetUrl);
    if (!sheetId) {
      throw new ApiError(400, "Invalid Google Sheet URL. Please ensure it is a valid link.");
    }

    try {
      csvContent = await fetchSheetCsv(sheetId);
    } catch (err) {
      throw new ApiError(400, err.message);
    }
  }

  if (!csvContent || csvContent.trim().length === 0) {
    throw new ApiError(400, "The data source appears to be empty.");
  }

  // Pre-process the CSV slightly to make it easily readable for OpenAI
  // Strip empty lines
  const cleanContent = csvContent
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n");

  const newSheet = await DynamicData.create({
    name,
    sourceType,
    googleSheetUrl: sourceType === 'google_sheet' ? googleSheetUrl : undefined,
    fileName: sourceType === 'file' ? fileName : undefined,
    content: cleanContent,
    createdBy: userId,
  });

  return res.status(201).json(new ApiResponse(201, newSheet, "Data source linked successfully"));
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
    throw new ApiError(404, "Data source not found");
  }

  if (sheetDoc.sourceType === "file") {
    throw new ApiError(400, "Cannot auto-resync an uploaded file. Please delete and upload a new one.");
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
