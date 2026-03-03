import { Router } from "express";
import {
  login,
  registerUser,
  logout,
  getCurrentUser,
  accessRefreshToken,
} from "../controllers/user.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.route("/register").post(registerUser)
router.route("/login").post(login)
router.route("/logout").post(verifyJWT, logout)
router.route("/refresh-tokens").post(accessRefreshToken)
router.route("/current-user").get(verifyJWT, getCurrentUser)


export default router;
