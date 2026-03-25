import { Router } from "express";
import {
    createSipExtension,
    deleteSipExtension,
    getAllSipExtensions,
    registerSipExtension,
    unregisterSipExtension,
    getAllExtensionStatus,
    getExtensionStatus,
    assignAgent,
    unassignAgent,
} from "../controllers/extension.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

// CRUD
router.route("/").get(getAllSipExtensions);
router.route("/").post(createSipExtension);
router.route("/:id").delete(deleteSipExtension);

// Register / Unregister
router.route("/register").post(registerSipExtension);
router.route("/unregister").post(unregisterSipExtension);

// Status
router.route("/status").get(getAllExtensionStatus);
router.route("/status/:extension").get(getExtensionStatus);

// Agent assignment
router.route("/:id/agent").patch(assignAgent).delete(unassignAgent);

export default router;