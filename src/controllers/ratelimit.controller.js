import { RateLimit } from "../models/ratelimit.model.js";
import { SipExtension } from "../models/extension.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// GET /api/v1/rate-limits
// Returns rate limit configs for all extensions owned by the user
const getAllRateLimits = asyncHandler(async (req, res) => {
  const userExtensions = await SipExtension.find({ createdBy: req.user._id }).select("_id extension displayName");
  const extensionIds = userExtensions.map((e) => e._id);

  const limits = await RateLimit.find({ extensionId: { $in: extensionIds } });

  // Merge extension info into each limit
  const result = userExtensions.map((ext) => {
    const limit = limits.find((l) => l.extensionId.toString() === ext._id.toString());
    return {
      extensionId: ext._id,
      extension: ext.extension,
      displayName: ext.displayName,
      config: limit
        ? {
            _id: limit._id,
            chatgpt: limit.chatgpt,
            deepgram: limit.deepgram,
            warningThreshold: limit.warningThreshold,
          }
        : null,
    };
  });

  return res.status(200).json(new ApiResponse(200, result, "Rate limits fetched"));
});

// GET /api/v1/rate-limits/:extensionId
const getRateLimit = asyncHandler(async (req, res) => {
  const { extensionId } = req.params;

  const ext = await SipExtension.findOne({ _id: extensionId, createdBy: req.user._id });
  if (!ext) throw new ApiError(404, "Extension not found or unauthorized");

  const limit = await RateLimit.findOne({ extensionId });

  return res.status(200).json(new ApiResponse(200, limit, "Rate limit fetched"));
});

// POST /api/v1/rate-limits/:extensionId
// Upsert rate limit config for a specific extension
const upsertRateLimit = asyncHandler(async (req, res) => {
  const { extensionId } = req.params;
  const { chatgpt, deepgram, warningThreshold } = req.body;

  const ext = await SipExtension.findOne({ _id: extensionId, createdBy: req.user._id });
  if (!ext) throw new ApiError(404, "Extension not found or unauthorized");

  const limit = await RateLimit.findOneAndUpdate(
    { extensionId },
    {
      extensionId,
      chatgpt: chatgpt || { maxTokensPerCall: 1000, maxTokensPerMinute: 5000, maxTokensPerHour: 50000 },
      deepgram: deepgram || { maxTokensPerCall: 1000, maxTokensPerMinute: 5000, maxTokensPerHour: 50000 },
      warningThreshold: warningThreshold ?? 80,
      createdBy: req.user._id,
    },
    { upsert: true, new: true, runValidators: true }
  );

  return res.status(200).json(new ApiResponse(200, limit, "Rate limit saved successfully"));
});

// DELETE /api/v1/rate-limits/:extensionId
const deleteRateLimit = asyncHandler(async (req, res) => {
  const { extensionId } = req.params;

  const ext = await SipExtension.findOne({ _id: extensionId, createdBy: req.user._id });
  if (!ext) throw new ApiError(404, "Extension not found or unauthorized");

  await RateLimit.findOneAndDelete({ extensionId });

  return res.status(200).json(new ApiResponse(200, null, "Rate limit removed"));
});

export { getAllRateLimits, getRateLimit, upsertRateLimit, deleteRateLimit };
