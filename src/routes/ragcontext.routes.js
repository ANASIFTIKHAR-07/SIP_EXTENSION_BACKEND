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
} from "../controllers/ragcontext.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(verifyJWT);

router.route("/").get(getAllRagFiles).post(upload.single("file"), uploadRagFile);
router.route("/active").get(getActiveRagFile);
router.route("/:id/activate").patch(activateRagFile);
router.route("/:id").get(getRagFileById).patch(updateRagText).delete(deleteRagFile);

export default router;
