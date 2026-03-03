import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import jwt from "jsonwebtoken";


export const verifyJWT = asyncHandler(async (req, res, next)=> {
    try {
        const token = req.cookies.accessToken || req.headers.authorization?.split(" ")[1];
        if (!token) {
            throw new ApiError(401, "Unauthorized request!");
        }

        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        console.log("Decoded token:", decodedToken);
        
        const user = await User.findById(decodedToken._id).select("-password -refreshToken");


        if (!user) {
            throw new ApiError(401, "Unauthorized request!");
        }


        req.user = {
            _id: user._id.toString(),
            fullName: user.fullName,
            email: user.email,
        }

        next()
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalide Access Token")
    }
})