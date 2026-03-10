import { Router } from "express";
import {
    getActiveCalls,
    startBot,
    stopBot,
    getCallHistory,
    getCallById,
} from "../controllers/call.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

// Active calls
router.route("/active").get(getActiveCalls);

// History
router.route("/history").get(getCallHistory);

// Single call detail
router.route("/:callId").get(getCallById);

// Bot control
router.route("/:callId/bot/start").post(startBot);
router.route("/:callId/bot/stop").post(stopBot);

export default router;