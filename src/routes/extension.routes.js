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


// POST   http://localhost:3000/register
// POST   http://localhost:3000/unregister
// GET    http://localhost:3000/status
// GET    http://localhost:3000/status/:extension

export default router;