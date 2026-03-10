import { CallLog } from "../models/calllog.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// ── In-memory store for active calls (populated by realtime.js) ───────────────
// key: callId  →  value: { session, fromNumber, toNumber, extension, startedAt, botEnabled }
export const activeCalls = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/calls/active
// Returns all currently active calls
// ─────────────────────────────────────────────────────────────────────────────
const getActiveCalls = asyncHandler(async (req, res) => {
    const calls = [];

    for (const [callId, call] of activeCalls.entries()) {
        calls.push({
            callId,
            fromNumber: call.fromNumber,
            toNumber: call.toNumber,
            extension: call.extension,
            botEnabled: call.botEnabled,
            startedAt: call.startedAt,
            durationSeconds: Math.floor((Date.now() - call.startedAt.getTime()) / 1000),
        });
    }

    return res
        .status(200)
        .json(new ApiResponse(200, calls, `${calls.length} active call(s)`));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/calls/:callId/bot/start
// Re-enable the AI bot on an active call
// ─────────────────────────────────────────────────────────────────────────────
const startBot = asyncHandler(async (req, res) => {
    const { callId } = req.params;

    const call = activeCalls.get(callId);
    if (!call) throw new ApiError(404, `No active call with id: ${callId}`);

    call.botEnabled = true;

    await CallLog.findOneAndUpdate({ callId }, { botEnabled: true });

    return res
        .status(200)
        .json(new ApiResponse(200, { callId, botEnabled: true }, "Bot started on call"));
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/calls/:callId/bot/stop
// Disable the AI bot on an active call (call stays alive)
// ─────────────────────────────────────────────────────────────────────────────
const stopBot = asyncHandler(async (req, res) => {
    const { callId } = req.params;

    const call = activeCalls.get(callId);
    if (!call) throw new ApiError(404, `No active call with id: ${callId}`);

    call.botEnabled = false;

    // Stop any currently streaming TTS
    if (call.session?.currentSender) {
        call.session.currentSender.stop();
    }

    await CallLog.findOneAndUpdate({ callId }, { botEnabled: false });

    return res
        .status(200)
        .json(new ApiResponse(200, { callId, botEnabled: false }, "Bot stopped on call"));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/calls/history
// Paginated call log history
// Query: ?page=1&limit=20&status=ended&extension=208
// ─────────────────────────────────────────────────────────────────────────────
const getCallHistory = asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.extension) filter.extension = req.query.extension;
    if (req.query.from) filter.startedAt = { $gte: new Date(req.query.from) };
    if (req.query.to) {
        filter.startedAt = {
            ...(filter.startedAt || {}),
            $lte: new Date(req.query.to),
        };
    }

    const [logs, total] = await Promise.all([
        CallLog.find(filter).sort({ startedAt: -1 }).skip(skip).limit(limit),
        CallLog.countDocuments(filter),
    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                logs,
                pagination: {
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                },
            },
            "Call history fetched"
        )
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/calls/:callId
// Get details of a single call (active or historic)
// ─────────────────────────────────────────────────────────────────────────────
const getCallById = asyncHandler(async (req, res) => {
    const { callId } = req.params;

    // Check active calls first
    if (activeCalls.has(callId)) {
        const call = activeCalls.get(callId);
        return res.status(200).json(
            new ApiResponse(200, {
                callId,
                status: "active",
                fromNumber: call.fromNumber,
                toNumber: call.toNumber,
                extension: call.extension,
                botEnabled: call.botEnabled,
                startedAt: call.startedAt,
                durationSeconds: Math.floor((Date.now() - call.startedAt.getTime()) / 1000),
            }, "Call found (active)")
        );
    }

    // Fall back to DB
    const log = await CallLog.findOne({ callId });
    if (!log) throw new ApiError(404, "Call not found");

    return res.status(200).json(new ApiResponse(200, log, "Call found"));
});

export {
    getActiveCalls,
    startBot,
    stopBot,
    getCallHistory,
    getCallById,
};