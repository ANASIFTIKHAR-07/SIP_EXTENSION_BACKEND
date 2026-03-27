import { Router } from "express";
import {
  getAllAgents,
  createAgent,
  updateAgent,
  deleteAgent,
  addRagFile,
  removeRagFile,
} from "../controllers/aiagent.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/upload.middleware.js";

const router = Router();
router.use(verifyJWT);

router.route("/").get(getAllAgents).post(createAgent);
router.route("/:id").patch(updateAgent).delete(deleteAgent);
router.route("/:id/rag-files").post(upload.single("file"), addRagFile);
router.route("/:id/rag-files/:fileId").delete(removeRagFile);

export default router;
