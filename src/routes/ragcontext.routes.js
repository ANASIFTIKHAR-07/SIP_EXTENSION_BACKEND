import { Router } from "express";
import multer from "multer";
import {
  uploadRagFile,
  getAllRagFiles,
  getActiveRagFile,
  getRagFileById,
  activateRagFile,
  updateRagText,
  deleteRagFile,
  reprocessRagFile,
} from "../controllers/ragcontext.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB for large docs

router.use(verifyJWT);

router.route("/").get(getAllRagFiles).post(upload.single("file"), uploadRagFile);
router.route("/active").get(getActiveRagFile);
router.route("/:id/activate").patch(activateRagFile);
router.route("/:id/reprocess").post(reprocessRagFile);
router.route("/:id").get(getRagFileById).patch(updateRagText).delete(deleteRagFile);

export default router;
