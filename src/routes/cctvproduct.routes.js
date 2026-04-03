import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { syncCatalog, getProducts, deleteProduct } from "../controllers/cctvproduct.controller.js";

const router = Router();

router.use(verifyJWT);

router.route("/").get(getProducts);
router.route("/sync").post(syncCatalog);
router.route("/:id").delete(deleteProduct);

export default router;
