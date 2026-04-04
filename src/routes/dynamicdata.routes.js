import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";
import { addDynamicData, getDynamicData, resyncDynamicData, deleteDynamicData } from "../controllers/dynamicdata.controller.js";

const router = Router();

router.use(verifyJWT);

router.route("/").get(getDynamicData).post(upload.single("file"), addDynamicData);
router.route("/:id").delete(deleteDynamicData);
router.route("/:id/sync").post(resyncDynamicData);

export default router;
