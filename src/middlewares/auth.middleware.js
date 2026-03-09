// auth.middleware.js
import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import jwt from "jsonwebtoken";

export const verifyJWT = asyncHandler(async (req, res, next) => {
  const token = req.cookies?.accessToken || req.headers.authorization?.split(" ")[1];

  if (!token) {
    throw new ApiError(401, "Unauthorized request!");
  }

  let decodedToken;
  try {
    decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new ApiError(401, "Access token expired");
    }
    throw new ApiError(401, "Invalid access token");
  }

  // DB errors from here bubble up as 500, not 401
  const user = await User.findById(decodedToken._id).select("-password -refreshToken");

  if (!user) {
    throw new ApiError(401, "User not found");
  }

  req.user = {
    _id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
  };

  next();
});