import { Router } from "express";
import {
    createSipExtension,
    deleteSipExtension,
    getAllSipExtensions,
} from "../controllers/extension.controller.js"
import { verifyJWT } from "../middlewares/auth.middleware.js";


const router = Router();

router.use(verifyJWT);


router.route("/").get(getAllSipExtensions)
router.route("/").post(createSipExtension)
router.route("/:id").delete(deleteSipExtension)


export default router;