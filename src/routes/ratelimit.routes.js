import { Router } from "express";
import {
  getAllRateLimits,
  getRateLimit,
  upsertRateLimit,
  deleteRateLimit,
} from "../controllers/ratelimit.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();
router.use(verifyJWT);

router.route("/").get(getAllRateLimits);
router.route("/:extensionId").get(getRateLimit).post(upsertRateLimit).delete(deleteRateLimit);

export default router;
